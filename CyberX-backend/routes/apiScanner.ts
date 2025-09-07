import { Router } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// Recreate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default API wordlist (common endpoints)
const defaultWordlistPath = path.join(__dirname, "../scanners/api-wordlist.txt");
let defaultWordlist: string[] = [];
if (fs.existsSync(defaultWordlistPath)) {
  defaultWordlist = fs.readFileSync(defaultWordlistPath, "utf8").split(/\r?\n/).filter(Boolean);
}

// Simple concurrency limiter (like DirFuzzer)
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    if (queue.length) queue.shift()!();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => {
            resolve(v);
            next();
          })
          .catch((e) => {
            reject(e);
            next();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

router.post("/", async (req, res) => {
  try {
    const {
      baseUrl,
      paths,
      useDefault = true,
      concurrency = 15,
      timeoutMs = 5000,
    } = req.body || {};

    if (!baseUrl) {
      return res.status(400).json({ error: "Base URL is required" });
    }

    let base = String(baseUrl).trim();
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    if (!base.endsWith("/")) base += "/";

    // Build path list
    let pathList: string[] = [];
    if (paths) {
      if (Array.isArray(paths)) pathList = paths.filter(Boolean);
      else pathList = String(paths).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    if (useDefault) pathList = [...new Set([...pathList, ...defaultWordlist])];

    if (pathList.length === 0) {
      return res.status(400).json({ error: "No paths to scan" });
    }

    const instance = axios.create({
      timeout: Number(timeoutMs) || 5000,
      validateStatus: () => true,
    });

    const limiter = pLimit(Number(concurrency) || 15);

    const results: Array<any> = [];

    const scanEndpoint = async (p: string) => {
      const fullUrl = new URL(p, base).toString();
      try {
        const resp = await instance.get(fullUrl);
        results.push({
          path: p,
          url: fullUrl,
          status: resp.status,
          contentType: resp.headers["content-type"] || "unknown",
          length: resp.headers["content-length"]
            ? Number(resp.headers["content-length"])
            : (resp.data ? String(resp.data).length : 0),
        });
      } catch (e: any) {
        results.push({
          path: p,
          url: fullUrl,
          status: "error",
          error: e.message,
        });
      }
    };

    // Schedule scans
    const tasks = pathList.map((p) => limiter(() => scanEndpoint(p)));
    await Promise.allSettled(tasks);

    // Categorize results
    const valid = results.filter((r) => r.status >= 200 && r.status < 300);
    const forbidden = results.filter((r) => r.status === 401 || r.status === 403);
    const missing = results.filter((r) => r.status === 404);

    res.json({
      base,
      tried: pathList.length,
      validCount: valid.length,
      forbiddenCount: forbidden.length,
      missingCount: missing.length,
      results: results.slice(0, 200), // limit response
    });
  } catch (e: any) {
    console.error("apiScanner error:", e);
    res.status(500).json({ error: e?.message || "API scan failed" });
  }
});

export default router;
