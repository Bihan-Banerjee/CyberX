// CyberX-backend/routes/dirFuzzer.ts
import { Router } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// Recreate __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load default small wordlist
const defaultListPath = path.join(__dirname, "../scanners/fuzz-wordlist.txt");
let defaultWordlist: string[] = [];
if (fs.existsSync(defaultListPath)) {
  defaultWordlist = fs.readFileSync(defaultListPath, "utf8").split(/\r?\n/).filter(Boolean);
}

// Simple promise-concurrency limiter
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
      target,            // required, full base URL or host (e.g. https://example.com or example.com)
      paths,             // optional custom array of paths or newline-separated string
      useDefault = true, // whether to use bundled list
      extensions = "",   // comma separated, e.g. "php,html,txt"
      method = "HEAD",   // HEAD by default, can be GET for content
      concurrency = 20,
      delayMs = 50,      // polite delay between requests
      timeoutMs = 5000,
      followRedirects = false,
    } = req.body || {};

    if (!target) return res.status(400).json({ error: "target is required" });

    // Normalize base URL
    let base = String(target).trim();
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;

    // Build path list
    let pathList: string[] = [];
    if (paths) {
      if (Array.isArray(paths)) pathList = paths.filter(Boolean);
      else pathList = String(paths).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }

    if (useDefault) pathList = [...new Set([...pathList, ...defaultWordlist])];

    // extensions array
    const exts = String(extensions || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // Expand paths with extensions
    const expanded: string[] = [];
    for (const p of pathList) {
      expanded.push(p);
      if (exts.length) {
        for (const e of exts) {
          const dot = e.startsWith(".") ? "" : ".";
          expanded.push(`${p}${dot}${e}`);
        }
      }
    }

    // dedupe
    const targets = Array.from(new Set(expanded)).slice(0, 20000); // limit to 20k entries max

    // polite: limit total targets to prevent accidental overuse
    if (targets.length === 0) return res.status(400).json({ error: "no paths to test" });

    // configure axios instance
    const instance = axios.create({
      timeout: Number(timeoutMs) || 5000,
      maxRedirects: followRedirects ? 5 : 0,
      validateStatus: () => true, // we want to capture all status codes
    });

    const limiter = pLimit(Number(concurrency) || 20);

    const results: Array<any> = [];
    let processed = 0;

    // helper to test single path
    const testPath = async (p: string) => {
      const full = new URL(p, base).toString();
      try {
        const start = Date.now();
        const resp = await instance.request({ url: full, method: method as any });
        const elapsed = Date.now() - start;
        // Consider 200..399 as interesting; include 401/403 also
        results.push({
          path: p,
          url: full,
          status: resp.status,
          length: resp.headers['content-length'] ? Number(resp.headers['content-length']) : (resp.data ? String(resp.data).length : 0),
          elapsedMs: elapsed,
          headers: {
            server: resp.headers.server || null,
            'content-type': resp.headers['content-type'] || null,
          },
        });
      } catch (err: any) {
        // network errors are ignored (but recorded optionally)
        results.push({
          path: p,
          url: full,
          error: String(err.message || err),
        });
      } finally {
        processed++;
      }
    };

    // schedule tasks with concurrency & polite delay
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const task = limiter(async () => {
        await testPath(p);
        // small delay between requests (per-slot)
        if (delayMs) await new Promise((r) => setTimeout(r, Number(delayMs)));
      });
      tasks.push(task);
    }

    // stream-like response: wait for all tasks
    await Promise.allSettled(tasks);

    // filter interesting results (common choices)
    const interesting = results.filter(r => {
      if (r.error) return false;
      const s = Number(r.status) || 0;
      // flag responses that are not 404/400 and not 0
      return (s >= 200 && s < 600 && s !== 404);
    });

    res.json({
      target: base,
      tried: targets.length,
      processed,
      foundCount: interesting.length,
      found: interesting.slice(0, 200), // limit returned items to 200
      rawAll: results.length > 200 ? undefined : results,
    });
  } catch (e: any) {
    console.error("dir-fuzzer error:", e);
    res.status(500).json({ error: e?.message || "fuzz failed" });
  }
});

export default router;
