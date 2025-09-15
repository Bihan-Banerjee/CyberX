// CyberX-backend/routes/jwtDecoder.ts
import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

router.post("/", async (req, res) => {
  try {
    let { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "JWT token is required" });
    }

    // ✅ Trim whitespace & collapse line breaks
    token = token.trim().replace(/\s+/g, "");

    // ✅ Split parts
    const parts = token.split(".");
    if (parts.length < 2) {
      return res.status(400).json({ error: "Invalid JWT format" });
    }

    const [headerB64, payloadB64, signatureB64 = ""] = parts;

    // Helper to decode safely
    const base64UrlDecode = (str: string) => {
      try {
        const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
        return Buffer.from(padded, "base64").toString("utf8");
      } catch {
        return "{}";
      }
    };

    // Decode header & payload
    let header: any, payload: any;
    try {
      header = JSON.parse(base64UrlDecode(headerB64));
    } catch {
      header = {};
    }

    try {
      payload = JSON.parse(base64UrlDecode(payloadB64));
    } catch {
      payload = {};
    }

    res.json({
      valid: true,
      header,
      payload,
      signature: signatureB64 || null, // null for unsigned tokens
      raw: {
        headerB64,
        payloadB64,
        signatureB64: signatureB64 || null,
      },
    });
  } catch (err: any) {
    console.error("JWT decode error:", err.message);
    res.status(500).json({ error: "Failed to decode JWT" });
  }
});

export default router;
