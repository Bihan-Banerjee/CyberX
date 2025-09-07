import { Router } from "express";
import dns from "dns/promises";

const router = Router();

/**
 * @route   POST /api/dnsrecon
 * @desc    Enumerate DNS records (A, AAAA, MX, TXT, CNAME, NS, SOA)
 * @access  Public
 */
router.post("/", async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    const results: any = {};

    try {
      results.A = await dns.resolve4(domain);
    } catch {
      results.A = [];
    }

    try {
      results.AAAA = await dns.resolve6(domain);
    } catch {
      results.AAAA = [];
    }

    try {
      results.MX = await dns.resolveMx(domain);
    } catch {
      results.MX = [];
    }

    try {
      results.TXT = await dns.resolveTxt(domain);
    } catch {
      results.TXT = [];
    }

    try {
      results.CNAME = await dns.resolveCname(domain);
    } catch {
      results.CNAME = [];
    }

    try {
      results.NS = await dns.resolveNs(domain);
    } catch {
      results.NS = [];
    }

    try {
      results.SOA = await dns.resolveSoa(domain);
    } catch {
      results.SOA = {};
    }

    res.json({ success: true, records: results });
  } catch (err: any) {
    console.error("DNS Recon Error:", err);
    res.status(500).json({ error: "DNS recon failed" });
  }
});

export default router;
