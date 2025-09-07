import { Router } from "express";
import whois from "whois-json";

const router = Router();

/**
 * @route   POST /api/whois
 * @desc    Perform WHOIS lookup for a given domain
 * @access  Public
 */
router.post("/", async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    // Perform WHOIS lookup
    const data = await whois(domain);

    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "WHOIS data not found" });
    }

    res.json({ success: true, whois: data });
  } catch (err: any) {
    console.error("WHOIS lookup error:", err);
    res.status(500).json({ error: "WHOIS lookup failed" });
  }
});

export default router;
