// src/server/routes/scan.ts
import { Router } from 'express';
import { portScan, parsePorts } from '../scanners/portScanner';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { target, ports, tcp = true, udp = false, timeoutMs = 1200, concurrency = 200, retries = 2 } = req.body || {};
    if (!target || !ports) return res.status(400).json({ error: 'target and ports are required' });

    const portList = parsePorts(String(ports));
    const results = await portScan({
      target,
      ports: portList,
      tcp: Boolean(tcp),
      udp: Boolean(udp),
      timeoutMs: Math.max(200, Number(timeoutMs) || 1200),
      concurrency: Math.max(1, Number(concurrency) || 200),
      retries: Math.max(1, Number(retries) || 2),
    });

    res.json({ target, count: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'scan failed' });
  }
});

export default router;
