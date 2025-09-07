import { Router } from "express";
import axios from "axios";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "IP address required" });

    // ✅ Use HackerTarget API (Free)
    const response = await axios.get(
      `https://api.hackertarget.com/reverseiplookup/?q=${ip}`
    );

    // HackerTarget returns plain text with domains separated by new lines
    if (!response.data || response.data.includes("error")) {
      return res.status(404).json({ error: "No domains found or invalid IP." });
    }

    const domains = response.data
      .split("\n")
      .map((d: string) => d.trim())
      .filter(Boolean);

    res.json({
      success: true,
      ip,
      total: domains.length,
      domains,
    });
  } catch (err: any) {
    console.error(err.message);
    res.status(500).json({ error: "Reverse IP lookup failed" });
  }
});

export default router;
