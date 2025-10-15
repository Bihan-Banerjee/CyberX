import express, { Request, Response } from 'express';
const router = express.Router();

// This will eventually interact with Zeek/ELK to get real data.
// For now, we'll return mock data to build the frontend.
router.get('/summary', (req: Request, res: Response) => {
    try {
        // MOCK DATA
        const summaryStats = {
            activeHoneypots: 3, // e.g., Cowrie, Dionaea, and a custom one
            attacksBlocked: 147,
            highSeverityAlerts: 12,
            uniqueAttackers: 89,
        };

        // MOCK DATA
        const recentAttacks = [
            { timestamp: new Date(Date.now() - 5 * 1000).toISOString(), type: 'SSH Brute-force', attackerIp: '203.0.113.45', honeypot: 'Cowrie', severity: 'High' },
            { timestamp: new Date(Date.now() - 25 * 1000).toISOString(), type: 'SMB Probe', attackerIp: '198.51.100.12', honeypot: 'Dionaea', severity: 'Medium' },
            { timestamp: new Date(Date.now() - 45 * 1000).toISOString(), type: 'HTTP GET /admin', attackerIp: '192.0.2.100', honeypot: 'HTTP-Basic', severity: 'Low' },
            { timestamp: new Date(Date.now() - 65 * 1000).toISOString(), type: 'Telnet Login Attempt', attackerIp: '203.0.113.45', honeypot: 'Cowrie', severity: 'Medium' },
        ];

        res.json({ summaryStats, recentAttacks });

    } catch (error) {
        console.error("Error fetching honeypot summary:", error);
        res.status(500).json({ error: "Failed to retrieve honeypot data." });
    }
});

export default router;
