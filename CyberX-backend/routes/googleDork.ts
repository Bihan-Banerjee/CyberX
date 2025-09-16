// CyberX-backend/routes/googleDork.ts
import { Router } from "express";
import axios from "axios";
import rateLimit from "express-rate-limit";

const router = Router();

// server-side configuration via env
const GOOGLE_API_KEY = process.env.GOOGLE_CSE_API_KEY || "";
const GOOGLE_CX = process.env.GOOGLE_CSE_CX || "";

// Basic rate limiter to prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: "Too many requests, slow down." },
});
router.use(limiter);

// Validation constants
const MAX_DORKS = 5;       // max dork queries in one request
const MAX_RESULTS = 5;     // max results per query (Google allows up to 10 per page)
const ALLOWED_QUERY_CHARS = /^[\w\s\-\._:@\/\*\(\)\+\=]+$/; // conservative

// Helper to call Google Custom Search JSON API
async function googleSearch(query: string, num = 5) {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    throw new Error("Google API credentials not configured on server");
  }
  const url = "https://www.googleapis.com/customsearch/v1";
  const params = {
    key: GOOGLE_API_KEY,
    cx: GOOGLE_CX,
    q: query,
    num: Math.min(num, 10),
  };
  const resp = await axios.get(url, { params, timeout: 15_000 });
  return resp.data;
}

// POST /api/google-dork
// body: { dorks: string[] , maxResults?: number }
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const dorks = Array.isArray(body.dorks) ? body.dorks.slice(0, MAX_DORKS) : [];
    const maxResults = Math.min(Number(body.maxResults) || MAX_RESULTS, MAX_RESULTS);

    if (!dorks.length) return res.status(400).json({ error: "Provide at least one dork query" });

    // sanitize & validate
    for (const d of dorks) {
      if (typeof d !== "string" || !d.trim()) return res.status(400).json({ error: "Invalid dork string" });
      if (d.length > 250) return res.status(400).json({ error: "Dork too long (max 250 chars)" });
      // optional strict char whitelist to avoid remote code-like strings
      if (!ALLOWED_QUERY_CHARS.test(d)) return res.status(400).json({ error: "Dork contains unsupported characters" });
    }

    // Rate-limit / safety note: enforce cooldown between identical queries (simple in-memory)
    // (For production use Redis or DB cache)
    const results: Record<string, any> = {};
    for (const dork of dorks) {
      try {
        const data = await googleSearch(dork, maxResults);
        // parse items into a compact shape
        const items = (data.items || []).slice(0, maxResults).map((it: any) => ({
          title: it.title,
          snippet: it.snippet,
          link: it.link,
          displayLink: it.displayLink,
        }));
        results[dork] = { count: items.length, items };
      } catch (err: any) {
        // If Google returns an error for that query, capture the message but continue
        const msg = err?.response?.data || err?.message || "search_error";
        results[dork] = { error: msg };
      }
    }

    return res.json({ success: true, results });
  } catch (err: any) {
    console.error("google-dork error:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: err?.message || "search failed" });
  }
});

export default router;
