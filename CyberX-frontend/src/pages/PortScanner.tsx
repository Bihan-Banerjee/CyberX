import React, { useState } from 'react';

type ScanRow = {
  port: number;
  protocol: 'tcp'|'udp';
  state: 'open'|'closed'|'filtered'|'open|filtered';
  reason: string;
  latencyMs: number|null;
};

export default function PortScannerPage() {
  const [target, setTarget] = useState('scanme.nmap.org');
  const [ports, setPorts] = useState('22,53,80,443,8000-8010');
  const [tcp, setTcp] = useState(true);
  const [udp, setUdp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [error, setError] = useState<string|null>(null);

  const runScan = async () => {
    setLoading(true); setError(null); setRows([]);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, ports, tcp, udp, timeoutMs: 1200, concurrency: 200, retries: 2 })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.results);
    } catch (e:any) {
      setError(e.message || 'scan failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-20 mx-auto max-w-4xl p-6 bg-black/30 backdrop-blur-xl rounded-2xl border border-white/10">
      <h2 className="text-2xl font-bold mb-4">Port Scanner</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <label className="flex flex-col">
          <span className="text-sm mb-1">Target (host/IP)</span>
          <input className="bg-black/40 border border-white/10 rounded px-3 py-2" value={target} onChange={e=>setTarget(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="text-sm mb-1">Ports (e.g. 22,80,443,8000-8100)</span>
          <input className="bg-black/40 border border-white/10 rounded px-3 py-2" value={ports} onChange={e=>setPorts(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={tcp} onChange={e=>setTcp(e.target.checked)} />
          <span>TCP</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={udp} onChange={e=>setUdp(e.target.checked)} />
          <span>UDP</span>
        </label>
      </div>
      <button disabled={loading} onClick={runScan}
        className="px-4 py-2 rounded bg-cyan-600/30 border border-cyan-400/40 hover:bg-cyan-600/40">
        {loading ? 'Scanning…' : 'Scan'}
      </button>

      {error && <p className="mt-4 text-red-300">{error}</p>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-white/80">
            <tr>
              <th className="text-left p-2">Port</th>
              <th className="text-left p-2">Proto</th>
              <th className="text-left p-2">State</th>
              <th className="text-left p-2">Reason</th>
              <th className="text-left p-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className="p-2">{r.port}</td>
                <td className="p-2">{r.protocol}</td>
                <td className="p-2">{r.state}</td>
                <td className="p-2">{r.reason}</td>
                <td className="p-2">{r.latencyMs ?? '-' } ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
