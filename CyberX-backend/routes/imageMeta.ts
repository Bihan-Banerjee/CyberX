// CyberX-backend/routes/imageMeta.ts
import { Router } from "express";
import multer from "multer";
import exifr from "exifr";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image file required" });

    // Try to parse EXIF/IPTC/XMP
    const metadata = await exifr.parse(req.file.buffer, { 
      tiff: true,
      xmp: true,
      iptc: true,
      gps: true
    });

    if (!metadata) return res.json({ success: true, metadata: {}, message: "No metadata found" });

    res.json({
      success: true,
      metadata
    });
  } catch (err: any) {
    console.error("Metadata error:", err);
    res.status(500).json({ error: err.message || "Failed to extract metadata" });
  }
});

export default router;
