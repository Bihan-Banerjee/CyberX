// CyberX-backend/routes/hash.ts
import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import readline from "readline";
import path from "path";

const router = Router();

// Allowed algorithms
const ALGOS = new Set(["md5", "sha1", "sha256", "sha512"]);

// Helper to compute hex digest
function computeHash(algo: string, input: string): string {
  return crypto.createHash(algo).update(input, "utf8").digest("hex");
}

/**
 * POST /api/hash/generate
 * body: { algorithm: "sha256", text: "hello" }
 */
router.post("/generate", async (req, res) => {
  try {
    const { algorithm = "sha256", text } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).json({ error: "text required" });
    if (!ALGOS.has(String(algorithm).toLowerCase())) {
      return res.status(400).json({ error: `algorithm must be one of ${Array.from(ALGOS).join(", ")}` });
    }
    const algo = String(algorithm).toLowerCase();
    const digest = computeHash(algo, text);
    res.json({ algorithm: algo, text, digest });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "generate failed" });
  }
});

/**
 * POST /api/hash/crack
 * body: {
 *   algorithm: "sha256",
 *   targetHash: "...",
 *   salt: "",                 // optional salt appended (or prepend handled by mode below)
 *   saltMode: "suffix",      // "suffix" | "prefix" (how to apply salt)
 *   wordlistPath: "/full/path/or/default", // optional path on server
 *   candidates: ["a","b"]    // optional inline candidates array
 *   maxAttempts: 20000,
 *   timeoutMs: 60_000
 * }
 *
 * NOTE: This endpoint performs a dictionary attack only. It DOES NOT perform brute force.
 */
router.post("/crack", async (req, res) => {
  try {
    const {
      algorithm = "sha256",
      targetHash,
      salt = "",
      saltMode = "suffix",
      wordlistPath,
      candidates,
      maxAttempts = 50000,
      timeoutMs = 60_000,
    } = req.body || {};

    if (!targetHash || typeof targetHash !== "string")
      return res.status(400).json({ error: "targetHash required" });

    if (!ALGOS.has(String(algorithm).toLowerCase()))
      return res.status(400).json({ error: `algorithm must be one of ${Array.from(ALGOS).join(", ")}` });

    const algo = String(algorithm).toLowerCase();

    // Safety: maxAttempts caps
    const max = Math.max(1, Math.min(Number(maxAttempts) || 50000, 500000));

    // Build candidate source: inline list takes precedence
    let candidateStream: AsyncIterable<string>;

    if (Array.isArray(candidates) && candidates.length > 0) {
      candidateStream = (async function* () {
        for (const c of candidates) yield String(c);
      })();
    } else if (wordlistPath && typeof wordlistPath === "string") {
      // Resolve path safely: allow absolute or relative to a configured scanner dir
      const resolved = path.isAbsolute(wordlistPath)
        ? wordlistPath
        : path.join(process.cwd(), wordlistPath);
      if (!fs.existsSync(resolved)) return res.status(400).json({ error: "wordlist file not found" });
      const input = fs.createReadStream(resolved, { encoding: "utf8" });
      const rl = readline.createInterface({ input, crlfDelay: Infinity });
      candidateStream = (async function* () {
        for await (const line of rl) {
          const s = String(line).trim();
          if (s) yield s;
        }
      })();
    } else {
      return res.status(400).json({ error: "provide candidates[] or wordlistPath" });
    }

    const start = Date.now();
    let attempts = 0;
    let found: { candidate: string; digest: string } | null = null;

    const itr = candidateStream[Symbol.asyncIterator]();

    // iterate with timeout
    const deadline = start + Number(timeoutMs || 60000);

    while (attempts < max && Date.now() < deadline) {
      const { value, done } = await itr.next();
      if (done) break;
      attempts++;

      // apply salt mode
      const candidate = saltMode === "prefix" ? `${salt}${value}` : `${value}${salt}`;

      const digest = computeHash(algo, candidate);
      if (digest === targetHash) {
        found = { candidate: value, digest }; // return original candidate (without salt applied)
        break;
      }

      // yield periodically to avoid blocking (event loop cooperative)
      if (attempts % 1000 === 0) await new Promise((r) => setImmediate(r));
    }

    res.json({
      algorithm: algo,
      targetHash,
      attempts,
      maxAttempts: max,
      timeoutMs,
      found,
      elapsedMs: Date.now() - start,
      note:
        "Dictionary attack only. Use authorized test data. For large batch jobs use an offline worker with GPU/cluster.",
    });
  } catch (e: any) {
    console.error("hash crack error:", e);
    res.status(500).json({ error: e.message || "crack failed" });
  }
});

export default router;
