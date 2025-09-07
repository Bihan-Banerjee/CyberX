import { Router } from "express";
import axios from "axios";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "IP address or domain required" });

    // ✅ Use free IP geolocation API
    const response = await axios.get(`http://ip-api.com/json/${ip}`);

    const data = response.data;

    if (data.status === "fail") {
      return res.status(404).json({ error: data.message || "Location not found" });
    }

    res.json({
      success: true,
      ip: data.query,
      isp: data.isp,
      org: data.org,
      country: data.country,
      region: data.regionName,
      city: data.city,
      zip: data.zip,
      lat: data.lat,
      lon: data.lon,
      timezone: data.timezone,
    });
  } catch (err: any) {
    console.error(err.message);
    res.status(500).json({ error: "IP geolocation failed" });
  }
});

export default router;
