// CyberX-backend/routes/stegoImage.ts
import { Router } from "express";
import multer from "multer";
import { PNG } from "pngjs";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Helper: write 32-bit big-endian length + bytes into LSBs of PNG red channel
function embedMessageIntoPngBuffer(png: PNG, msgBuf: Buffer) {
  const width = png.width;
  const height = png.height;
  const pixelCount = width * height;
  const capacityBits = pixelCount; // 1 bit per pixel (red channel)
  const requiredBits = (4 + msgBuf.length) * 8; // 32-bit length + payload
  if (requiredBits > capacityBits) {
    throw new Error(`Message too large. Max bytes for this image: ${Math.floor((capacityBits - 32) / 8)}`);
  }

  // Build payload: 4 byte big-endian length + data
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const payload = Buffer.concat([lenBuf, msgBuf]);

  // Iterate payload bit-by-bit and set red LSB
  let bitIdx = 0;
  for (let i = 0; i < payload.length; i++) {
    const byte = payload[i];
    for (let b = 7; b >= 0; b--) {
      const bit = (byte >> b) & 1;
      const pixelIndex = bitIdx; // 0..pixelCount-1
      const pngOffset = pixelIndex * 4; // rgba
      // modify red channel LSB
      const red = png.data[pngOffset];
      png.data[pngOffset] = (red & 0xfe) | bit;
      bitIdx++;
    }
  }
  return png;
}

function extractMessageFromPngBuffer(png: PNG) {
  const width = png.width;
  const height = png.height;
  const pixelCount = width * height;
  const capacityBits = pixelCount;
  // read first 32 bits for length
  let bitIdx = 0;
  const readBit = () => {
    const pixelIndex = bitIdx;
    const pngOffset = pixelIndex * 4;
    const red = png.data[pngOffset];
    const bit = red & 1;
    bitIdx++;
    return bit;
  };

  // read 32-bit length
  let len = 0;
  for (let i = 0; i < 32; i++) {
    len = (len << 1) | readBit();
  }
  if (len < 0 || len > 20 * 1024 * 1024) throw new Error("Invalid embedded length"); // sanity cap 20MB

  const requiredBits = len * 8;
  if (32 + requiredBits > capacityBits) throw new Error("Declared message length exceeds image capacity");

  const out = Buffer.alloc(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | readBit();
    }
    out[byteIdx] = val;
  }

  return out;
}

router.post("/embed", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    const message = String(req.body.message || "");
    if (!file) return res.status(400).json({ error: "Image file required (PNG only)" });
    if (!message) return res.status(400).json({ error: "Message is required" });

    // quick type check by magic bytes
    const buf = file.buffer;
    // PNG signature: first 8 bytes
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    if (!isPng) {
      return res.status(400).json({ error: "Only PNG images supported (lossless). Convert JPEG to PNG first." });
    }

    const png = PNG.sync.read(buf);

    const msgBuf = Buffer.from(message, "utf8");
    // safety cap
    if (msgBuf.length > 20 * 1024 * 1024) return res.status(400).json({ error: "Message too large" });

    embedMessageIntoPngBuffer(png, msgBuf);
    const outBuf = PNG.sync.write(png);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", "attachment; filename=stego.png");
    res.send(outBuf);
  } catch (err: any) {
    console.error("stego embed error:", err?.message || err);
    res.status(500).json({ error: err.message || "embed failed" });
  }
});

router.post("/extract", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Image file required (PNG only)" });

    const buf = file.buffer;
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    if (!isPng) {
      return res.status(400).json({ error: "Only PNG images supported" });
    }

    const png = PNG.sync.read(buf);
    const msgBuf = extractMessageFromPngBuffer(png);
    const message = msgBuf.toString("utf8");
    res.json({ message, length: msgBuf.length });
  } catch (err: any) {
    console.error("stego extract error:", err?.message || err);
    res.status(500).json({ error: err.message || "extract failed" });
  }
});

export default router;
