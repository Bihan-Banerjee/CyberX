import { Router } from "express";
import fetch from "node-fetch";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const resp = await fetch(`https://leakcheck.io/api/public?check=${encodeURIComponent(email)}`);
    const data = await resp.json();

    if (!resp.ok) throw new Error(data?.error || "Failed to fetch breach data");

    res.json({
      found: data.found > 0,
      sources: data.sources || [],
    });
  } catch (err: any) {
    console.error("Breach check error:", err.message);
    res.status(500).json({ error: err.message || "Breach check failed" });
  }
});

export default router;
