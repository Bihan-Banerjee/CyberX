import { Router } from "express";
import axios from "axios";
import dns from "dns";
import fs from "fs";
import path from "path";
import util from "util";
import { fileURLToPath } from "url";

const resolveDns = util.promisify(dns.resolve);
const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load a small default wordlist for brute-force subdomain guessing
const wordlistPath = path.join(__dirname, "../scanners/subdomains.txt");
let defaultWordlist: string[] = [];
if (fs.existsSync(wordlistPath)) {
  defaultWordlist = fs.readFileSync(wordlistPath, "utf-8").split("\n").filter(Boolean);
}

// Helper: Passive Subdomain Enumeration via CRT.sh
async function getSubdomainsFromCRT(domain: string): Promise<string[]> {
  try {
    const url = `https://crt.sh/?q=%25.${domain}&output=json`;
    const { data } = await axios.get(url, { timeout: 10000 });

    if (!data || typeof data !== "object") return [];
    const subs = new Set<string>();
    data.forEach((entry: any) => {
      const name = entry.name_value;
      name.split("\n").forEach((sub: string) => {
        if (sub.includes(domain)) subs.add(sub.trim());
      });
    });

    return [...subs];
  } catch (err) {
    console.error("CRT.sh API error:", err.message);
    return [];
  }
}

// Helper: Active Subdomain Brute Forcing
async function bruteForceSubdomains(domain: string, limit = 50): Promise<string[]> {
  const results: string[] = [];
  const commonSubs = defaultWordlist.slice(0, limit);

  for (const sub of commonSubs) {
    const fqdn = `${sub}.${domain}`;
    try {
      await resolveDns(fqdn);
      results.push(fqdn);
    } catch {
      // Ignore unresolved subdomains
    }
  }

  return results;
}

router.post("/", async (req, res) => {
  try {
    const { domain, bruteForce = true, limit = 50 } = req.body;

    if (!domain) {
      return res.status(400).json({ error: "Target domain is required." });
    }

    const passiveSubs = await getSubdomainsFromCRT(domain);
    const bruteSubs = bruteForce ? await bruteForceSubdomains(domain, limit) : [];

    const uniqueSubs = Array.from(new Set([...passiveSubs, ...bruteSubs]));

    return res.json({ domain, count: uniqueSubs.length, subdomains: uniqueSubs });
  } catch (err: any) {
    console.error("Subdomain enumeration failed:", err);
    return res.status(500).json({ error: err.message || "Failed to enumerate subdomains" });
  }
});

export default router;
