// CyberX-backend/routes/stegoExtract.ts
import { Router } from "express";
import multer from "multer";
import { PNG } from "pngjs";
import wav from "node-wav";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// ---------- helpers for image extraction (red-channel LSB, big-endian length) ----------
function extractFromPngBuffer(buf: Buffer): { message: string | null; raw?: Buffer } {
  const png = PNG.sync.read(buf);
  const width = png.width;
  const height = png.height;
  const pixelCount = width * height;
  const capacityBits = pixelCount;

  let bitIdx = 0;
  const readBit = () => {
    const pngOffset = bitIdx * 4; // rgba
    const red = png.data[pngOffset];
    const bit = red & 1;
    bitIdx++;
    return bit;
  };

  // read 32-bit big-endian length
  let len = 0;
  for (let i = 0; i < 32; i++) {
    len = (len << 1) | readBit();
  }
  if (len <= 0 || len > (capacityBits - 32) / 8) throw new Error("Invalid embedded length (image)");
  const out = Buffer.alloc(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | readBit();
    }
    out[byteIdx] = val;
  }
  return { message: out.toString("utf8"), raw: out };
}

// ---------- helpers for audio extraction (LSB in first channel) ----------
function floatToLSBInt(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return Math.round(s * 32767);
}
function readBitFromFloatArray(samples: Float32Array, idx: number): number {
  return floatToLSBInt(samples[idx]) & 1;
}

// audio extractor: tries little-endian length (32 bits)
function extractFromWavBuffer(buf: Buffer): { message: string | null; raw?: Buffer } {
  const decoded = wav.decode(buf);
  if (!decoded || !decoded.channelData || decoded.channelData.length === 0) {
    throw new Error("Unsupported WAV format");
  }
  // use only the first channel (embedding convention)
  const channel: Float32Array = decoded.channelData[0];
  const totalSamples = channel.length;

  // Read 32-bit little-endian length
  let bitIdx = 0;
  let len = 0;
  for (let b = 0; b < 32; b++) {
    len |= (readBitFromFloatArray(channel, bitIdx++) << b);
  }

  if (len <= 0 || len > Math.floor(totalSamples / 8)) {
    throw new Error("Invalid embedded length (audio)");
  }

  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte |= (readBitFromFloatArray(channel, bitIdx++) << b);
    }
    out[i] = byte;
  }

  return { message: out.toString("utf8"), raw: out };
}

// ---------- main route ----------
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "File upload required (PNG or WAV)" });

    const buf = file.buffer;

    // detect PNG by signature
    const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const isPng = buf.slice(0, 8).equals(pngSig);

    // detect WAV by "RIFF" and "WAVE" markers
    const isWav = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WAVE";

    // Try PNG first if it is PNG
    if (isPng) {
      try {
        const extracted = extractFromPngBuffer(buf);
        return res.json({
          format: "png",
          success: true,
          isText: true,
          message: extracted.message,
          byteLength: extracted.raw?.length ?? 0,
        });
      } catch (err: any) {
        // fall through to try audio or report error
        return res.status(400).json({ error: "PNG extraction failed: " + (err.message || err) });
      }
    }

    // If WAV
    if (isWav) {
      try {
        const extracted = extractFromWavBuffer(buf);
        return res.json({
          format: "wav",
          success: true,
          isText: true,
          message: extracted.message,
          byteLength: extracted.raw?.length ?? 0,
        });
      } catch (err: any) {
        return res.status(400).json({ error: "WAV extraction failed: " + (err.message || err) });
      }
    }

    // If neither, attempt both heuristics (image first, then audio) - try-catch both
    // Attempt PNG decode fallback (might be PNG with offset)
    try {
      const extracted = extractFromPngBuffer(buf);
      return res.json({
        format: "png-heuristic",
        success: true,
        isText: true,
        message: extracted.message,
        byteLength: extracted.raw?.length ?? 0,
      });
    } catch (e) {
      // ignore
    }

    try {
      const extracted = extractFromWavBuffer(buf);
      return res.json({
        format: "wav-heuristic",
        success: true,
        isText: true,
        message: extracted.message,
        byteLength: extracted.raw?.length ?? 0,
      });
    } catch (e) {
      // ignore
    }

    return res.status(400).json({ error: "Unsupported file or no hidden payload found (supported: PNG, WAV)" });
  } catch (err: any) {
    console.error("stego-extract error:", err);
    res.status(500).json({ error: err.message || "Extraction failed" });
  }
});

export default router;
