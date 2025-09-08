import { Router } from "express";
import { exec } from "child_process";

const router = Router();

// Helper to execute kubectl commands safely
const runCmd = (cmd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) reject(stderr || error.message);
      else resolve(stdout);
    });
  });

router.post("/", async (_req, res) => {
  try {
    const results: Record<string, string> = {};

    // 1. Get all pods
    try {
      results.pods = await runCmd("kubectl get pods -A -o wide");
    } catch (err) {
      results.pods = `Error: ${err}`;
    }

    // 2. Get all services
    try {
      results.services = await runCmd("kubectl get svc -A -o wide");
    } catch (err) {
      results.services = `Error: ${err}`;
    }

    // 3. Get secrets (checks for misconfigured public secrets)
    try {
      results.secrets = await runCmd("kubectl get secrets -A");
    } catch (err) {
      results.secrets = `Error: ${err}`;
    }

    // 4. Check cluster roles & bindings
    try {
      results.roles = await runCmd("kubectl get clusterrolebindings");
    } catch (err) {
      results.roles = `Error: ${err}`;
    }

    // 5. Check API server info
    try {
      results.apiServer = await runCmd("kubectl cluster-info");
    } catch (err) {
      results.apiServer = `Error: ${err}`;
    }

    // 6. Check current user permissions
    try {
      results.permissions = await runCmd("kubectl auth can-i --list");
    } catch (err) {
      results.permissions = `Error: ${err}`;
    }

    res.json({ success: true, results });
  } catch (err: any) {
    console.error("K8s Enum Error:", err);
    res.status(500).json({ error: err.message || "Failed to enumerate Kubernetes resources" });
  }
});

export default router;
