import { Router } from "express";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);
const router = Router();

/**
 * POST /api/service-detect
 * Body: { target: string, ports?: string }
 */
router.post("/", async (req, res) => {
  try {
    const { target, ports } = req.body;

    if (!target) {
      return res.status(400).json({ error: "Target IP or domain is required." });
    }

    // Build nmap command
    let cmd = `nmap -sV ${target}`;
    if (ports) cmd += ` -p ${ports}`;

    console.log(`Running: ${cmd}`);
    const { stdout, stderr } = await execPromise(cmd);

    if (stderr) {
      console.error(stderr);
      return res.status(500).json({ error: "Error running nmap" });
    }

    // Parse open ports & services
    const results: {
      port: string;
      protocol: string;
      service: string;
      version: string;
    }[] = [];

    const regex = /^(\d+)\/(tcp|udp)\s+open\s+([^\s]+)\s+(.*)$/gm;
    let match;
    while ((match = regex.exec(stdout)) !== null) {
      results.push({
        port: match[1],
        protocol: match[2],
        service: match[3],
        version: match[4] || "Unknown",
      });
    }

    return res.json({ target, results, raw: stdout });
  } catch (err: any) {
    console.error("Service detection failed:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to detect services" });
  }
});

export default router;
