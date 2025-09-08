// CyberX-backend/routes/bucketFinder.ts
import { Router } from "express";
import axios from "axios";

const router = Router();

// Simple concurrency limiter
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

// URL templates to check per cloud provider
const PROVIDER_URLS = {
  aws: [
    (b: string) => `https://${b}.s3.amazonaws.com/`,
    (b: string) => `https://s3.amazonaws.com/${b}/`,
  ],
  gcp: [
    (b: string) => `https://storage.googleapis.com/${b}/`,
    (b: string) => `https://${b}.storage.googleapis.com/`,
  ],
  azure: [
    (b: string) => `https://${b}.blob.core.windows.net/`,
  ],
};

// heuristics to detect public/listable buckets
function analyzeResponse(body: string | null, status: number, headers: any) {
  const str = (body || "").toString();
  const lower = str.toLowerCase();
  const contentType = (headers?.['content-type'] || '').toLowerCase();

  const hints: string[] = [];

  if (status >= 200 && status < 300) hints.push("200_ok");
  if (status === 403) hints.push("forbidden_auth_required");
  if (status === 404) hints.push("not_found");
  if (/listbucketresult/i.test(str) || /<?xml/i.test(str) && /listbucketresult/i.test(str)) hints.push("s3_list_response");
  if (/<title>index of/i.test(lower) || /<h1>index of/i.test(lower) || /directory listing for/i.test(lower)) hints.push("dir_listing_html");
  if (/no such bucket/i.test(str) || /not found/i.test(lower) && contentType.includes('xml')) hints.push("no_such_bucket");
  if (contentType.includes('application/xml') && /error/i.test(str)) hints.push("xml_error");

  // If headers indicate public read (e.g. x-amz-request-id present and body is list)
  if (headers && (headers['x-amz-request-id'] || headers['x-goog-generation'])) {
    hints.push("provider_headers");
  }

  const isLikelyPublic = hints.includes("200_ok") &&
    (hints.includes("s3_list_response") || hints.includes("dir_listing_html") || hints.includes("provider_headers"));

  return { hints, isLikelyPublic };
}

router.post("/", async (req, res) => {
  try {
    const {
      names = "",           // newline separated or array of bucket names
      providers = ["aws","gcp","azure"],
      concurrency = 10,
      timeoutMs = 5000,
      useDefault = true,
    } = req.body || {};

    // default sample names if none and useDefault true
    const defaultSample = ["test", "dev", "staging", "backup", "uploads", "static", "assets", "public"];

    let nameList: string[] = [];
    if (Array.isArray(names)) nameList = names.map(String).map(s => s.trim()).filter(Boolean);
    else nameList = String(names || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    if (useDefault) nameList = Array.from(new Set([...nameList, ...defaultSample]));

    if (!nameList.length) return res.status(400).json({ error: "no bucket names provided" });

    const instance = axios.create({
      timeout: Number(timeoutMs) || 5000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "CyberX-BucketFinder/1.0 (+https://yourproject.example)",
      },
    });

    const limiter = pLimit(Number(concurrency) || 10);
    const results: any[] = [];

    // check a single bucket + provider template
    const checkUrl = async (url: string) => {
      try {
        // Use HEAD first to be polite; if HEAD not allowed, try GET
        const head = await instance.head(url);
        const bodyNeeded = !(head.status >= 200 && head.status < 400) && (head.status === 405 || head.status === 403 || head.status === 200);
        if (bodyNeeded === false && head.status >= 200 && head.status < 400) {
          const analysis = analyzeResponse(null, head.status, head.headers);
          return { url, status: head.status, headers: head.headers, body: null, analysis };
        }
        // fallback to GET
        const get = await instance.get(url);
        const analysis = analyzeResponse(typeof get.data === "string" ? get.data : JSON.stringify(get.data), get.status, get.headers);
        return { url, status: get.status, headers: get.headers, body: typeof get.data === "string" ? get.data.slice(0, 2000) : null, analysis };
      } catch (err: any) {
        return { url, error: String(err.message || err) };
      }
    };

    // Schedule checks for each name & provider
    const tasks: Promise<void>[] = [];
    for (const name of nameList) {
      for (const prov of providers) {
        const templates = PROVIDER_URLS[prov as keyof typeof PROVIDER_URLS] || [];
        for (const t of templates) {
          const url = t(name);
          const task = limiter(async () => {
            const r = await checkUrl(url);
            // keep minimal info
            results.push({
              name,
              provider: prov,
              url,
              status: r.status ?? null,
              error: r.error ?? null,
              hints: r.analysis?.hints ?? [],
              likelyPublic: r.analysis?.isLikelyPublic ?? false,
            });
            // small polite delay per-slot
            await new Promise((r) => setTimeout(r, 50));
          });
          tasks.push(task);
        }
      }
    }

    await Promise.allSettled(tasks);

    // summarize
    const publicBuckets = results.filter(r => r.likelyPublic);
    res.json({
      scanned: results.length,
      bucketsChecked: nameList.length,
      publicCount: publicBuckets.length,
      results,
    });
  } catch (e: any) {
    console.error("bucket-finder error:", e);
    res.status(500).json({ error: e?.message || "bucket finder failed" });
  }
});

export default router;
