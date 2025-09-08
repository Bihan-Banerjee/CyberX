// CyberX-backend/routes/containerScanner.ts
import { Router } from "express";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

const router = Router();

const cacheDir = "D:/trivy-cache";
const tmpDir = "D:/trivy-cache/tmp";

// Ensure both cache and temp dirs exist
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

router.post("/", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "Docker image name is required" });

    // Build Windows-compatible Trivy command
    const cmd = `trivy image --cache-dir "${cacheDir}" --format json --quiet ${image}`;

    exec(
      cmd,
      {
        maxBuffer: 1024 * 1024 * 10,
        env: {
          ...process.env,
          TRIVY_TEMP_DIR: tmpDir, // ✅ This works on Windows too
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Trivy scan failed:", stderr || error.message);
          return res.status(500).json({ error: stderr || error.message || "Failed to scan image" });
        }

        try {
          const json = JSON.parse(stdout);

          const vulnerabilities =
            json.Results?.flatMap((result: any) => result.Vulnerabilities || []) || [];

          res.json({
            image,
            total: vulnerabilities.length,
            vulnerabilities: vulnerabilities.map((vuln: any) => ({
              id: vuln.VulnerabilityID,
              pkgName: vuln.PkgName,
              installedVersion: vuln.InstalledVersion,
              fixedVersion: vuln.FixedVersion || "N/A",
              severity: vuln.Severity,
              title: vuln.Title,
              description: vuln.Description,
              references: vuln.References || [],
            })),
          });
        } catch (parseErr) {
          console.error("Failed to parse Trivy output:", parseErr);
          res.status(500).json({ error: "Failed to parse scan results" });
        }
      }
    );
  } catch (err: any) {
    console.error("Container scan route error:", err);
    res.status(500).json({ error: err.message || "Container scan failed" });
  }
});

export default router;
