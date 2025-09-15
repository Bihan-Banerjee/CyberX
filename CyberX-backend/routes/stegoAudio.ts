import { Router } from "express";
import multer from "multer";
import wav from "node-wav";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Treat float sample as signed 16-bit for LSB operations
 */
function floatToLSBInt(sample: number): number {
  let s = Math.max(-1, Math.min(1, sample));
  return Math.round(s * 32767);
}
function intToFloat(i: number): number {
  return i / 32767;
}

function setLSB(sample: number, bit: number): number {
  // Convert float sample → signed 16-bit int
  let intSample = floatToLSBInt(sample);

  // Clear LSB, then set it to `bit`
  intSample = (intSample & ~1) | (bit & 1);

  // Convert back to float sample
  return intToFloat(intSample);
}


function embedMessage(samples: Float32Array, message: Buffer): Float32Array {
  const len = message.length;
  const totalBits = 32 + len * 8;
  if (samples.length < totalBits) throw new Error("Not enough samples to embed message");

  const out = new Float32Array(samples);

  // Write 32-bit length, little endian
  for (let b = 0; b < 32; b++) {
    const bit = (len >> b) & 1;
    out[b] = setLSB(out[b], bit);
  }

  // Write message bytes
  let bitIdx = 32;
  for (let i = 0; i < len; i++) {
    for (let b = 0; b < 8; b++) {
      const bit = (message[i] >> b) & 1;
      out[bitIdx++] = setLSB(out[bitIdx], bit);
    }
  }

  return out;
}


function extractMessage(samples: Float32Array): Buffer {
  const readBit = (idx: number): number => {
    let val = floatToLSBInt(samples[idx]);
    return val & 1;
  };

  // Dump the first 64 bits so we can see what we’re reading
  let firstBits: number[] = [];
  for (let i = 0; i < 64 && i < samples.length; i++) {
    firstBits.push(readBit(i));
  }
  console.log("First 64 bits:", firstBits.join(""));

  // Reconstruct length
  let bitIdx = 0;
  let len = 0;
    for (let b = 0; b < 32; b++) {
      len |= readBit(bitIdx++) << b;
    }
    console.log("Decoded length:", len);

    if (len <= 0 || len > samples.length / 8) {  // sanity: can't be bigger than possible bytes
      throw new Error("Invalid embedded length: " + len);
    }


  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte |= readBit(bitIdx++) << b;
    }
    out[i] = byte;
  }
  return out;
}


router.post("/embed", upload.single("audio"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "WAV file required" });
    if (!req.body.message) return res.status(400).json({ error: "Message required" });

    const decoded = wav.decode(req.file.buffer);
    const channel = decoded.channelData[0]; // use only first channel

    const msgBuf = Buffer.from(req.body.message, "utf8");
    const newSamples = embedMessage(channel, msgBuf);

    const newWav = wav.encode([newSamples], {
      sampleRate: decoded.sampleRate,
      float: true,
    });

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", "attachment; filename=stego.wav");
    res.send(newWav);
  } catch (err: any) {
    console.error("Embed error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/extract", upload.single("audio"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "WAV file required" });

    const decoded = wav.decode(req.file.buffer);
    const channel = decoded.channelData[0];

    const msgBuf = extractMessage(channel);
    res.json({ message: msgBuf.toString("utf8"), length: msgBuf.length });
  } catch (err: any) {
    console.error("Extract error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
