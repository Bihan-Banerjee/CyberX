// src/server/scanners/portScanner.ts
import net from 'node:net';
import dgram from 'node:dgram';

export type ScanResult = {
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'open' | 'closed' | 'filtered' | 'open|filtered';
  reason: string;
  latencyMs: number | null;
};

export function parsePorts(ports: string): number[] {
  const out = new Set<number>();
  for (const part of ports.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((n) => parseInt(n, 10));
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let p = start; p <= end; p++) out.add(p);
    } else {
      out.add(parseInt(part, 10));
    }
  }
  return [...out]
    .filter((p) => Number.isFinite(p) && p > 0 && p < 65536)
    .sort((a, b) => a - b);
}

/**
 * TCP connect scan: succeeds on TCP handshake ("connect"), closed on ECONNREFUSED (RST), filtered on timeout/unreachables. 
 */
async function scanTcpPort(
  host: string,
  port: number,
  timeoutMs: number
): Promise<ScanResult> {
  const start = Date.now();
  return new Promise<ScanResult>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (state: ScanResult['state'], reason: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        port,
        protocol: 'tcp',
        state,
        reason,
        latencyMs: Date.now() - start,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => done('filtered', 'timeout'));
    socket.once('connect', () => done('open', 'tcp connect ok'));
    socket.once('error', (err: any) => {
      if (err?.code === 'ECONNREFUSED') done('closed', 'rst/econnrefused');
      else if (
        err?.code === 'EHOSTUNREACH' ||
        err?.code === 'ENETUNREACH' ||
        err?.code === 'ETIMEDOUT'
      )
        done('filtered', String(err.code).toLowerCase());
      else done('filtered', err?.code || 'error');
    });

    socket.connect(port, host);
  });
}

/**
 * UDP probe: reply => open, ICMP port unreachable => closed (often surfaces as ECONNREFUSED), else open|filtered after retries. 
 */
async function scanUdpPort(
  host: string,
  port: number,
  timeoutMs: number,
  retries: number
): Promise<ScanResult> {
  const start = Date.now();
  return new Promise<ScanResult>((resolve) => {
    const sock = dgram.createSocket('udp4');
    let responded = false;
    let attempts = 0;
    const payload = Buffer.alloc(0); // generic probe

    const finish = (state: ScanResult['state'], reason: string) => {
      try {
        sock.close();
      } catch {}
      resolve({
        port,
        protocol: 'udp',
        state,
        reason,
        latencyMs: responded ? Date.now() - start : null,
      });
    };

    sock.once('message', () => {
      responded = true;
      finish('open', 'udp reply');
    });

    sock.on('error', (err: any) => {
      if (err?.code === 'ECONNREFUSED') finish('closed', 'icmp port unreachable');
      else finish('filtered', err?.code || 'udp error');
    });

    const trySend = () => {
      attempts++;
      try {
        sock.send(payload, port, host, () => {
          setTimeout(() => {
            if (responded) return;
            if (attempts < retries) trySend();
            else finish('open|filtered', 'no response');
          }, timeoutMs);
        });
      } catch (e: any) {
        finish('filtered', e?.code || 'send error');
      }
    };

    trySend();
  });
}

export async function portScan(params: {
  target: string;
  ports: number[];
  tcp: boolean;
  udp: boolean;
  timeoutMs: number;
  concurrency: number;
  retries: number; // udp retries
}): Promise<ScanResult[]> {
  // Attach metadata to each task to avoid any/undefined indexing issues.
  type Task = {
    run: () => Promise<ScanResult>;
    meta: { port: number; protocol: 'tcp' | 'udp' };
  };
  const tasks: Task[] = [];

  for (const p of params.ports) {
    if (params.tcp)
      tasks.push({
        run: () => scanTcpPort(params.target, p, params.timeoutMs),
        meta: { port: p, protocol: 'tcp' },
      });
    if (params.udp)
      tasks.push({
        run: () => scanUdpPort(params.target, p, params.timeoutMs, params.retries),
        meta: { port: p, protocol: 'udp' },
      });
  }

  const results: ScanResult[] = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      const task = tasks[idx]!; // guarded by i < tasks.length, safe to assert
      try {
        const r = await task.run();
        results.push(r);
      } catch (e: any) {
        results.push({
          port: task.meta.port,
          protocol: task.meta.protocol,
          state: 'filtered',
          reason: e?.message || 'error',
          latencyMs: null,
        });
      }
    }
  }

  const poolSize = Math.max(1, params.concurrency);
  await Promise.all(new Array(poolSize).fill(0).map(() => worker()));

  results.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
  return results;
}
