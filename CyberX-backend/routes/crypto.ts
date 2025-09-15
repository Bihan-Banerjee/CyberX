import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import forge from "node-forge";

const router = Router();
const upload = multer();

function aesEncrypt(data: Buffer, key: string): Buffer {
  const keyBuf = crypto.createHash("sha256").update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function aesDecrypt(data: Buffer, key: string): Buffer {
  const keyBuf = crypto.createHash("sha256").update(key).digest();
  const iv = data.slice(0, 16);
  const tag = data.slice(16, 32);
  const enc = data.slice(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

router.post("/", upload.single("file"), (req, res) => {
  try {
    const { algo, mode, key, text } = req.body;
    const file = req.file;

    let input: Buffer;
    if (file) input = file.buffer;
    else input = Buffer.from(text || "", "utf-8");

    let output: Buffer;

    if (algo === "aes") {
      if (mode === "encrypt") output = aesEncrypt(input, key);
      else output = aesDecrypt(input, key);
    } else if (algo === "rsa") {
      const rsaKey = forge.pki.privateKeyFromPem(key) || forge.pki.publicKeyFromPem(key);
      if (mode === "encrypt") {
        output = Buffer.from(rsaKey.encrypt(input.toString("binary")), "binary");
      } else {
        output = Buffer.from(rsaKey.decrypt(input.toString("binary")), "binary");
      }
    } else {
      return res.status(400).json({ error: "Invalid algo" });
    }

    if (file) {
      res.setHeader("Content-Disposition", "attachment; filename=out.bin");
      return res.send(output);
    } else {
      return res.send(mode === "encrypt" ? output.toString("base64") : output.toString("utf-8"));
    }
  } catch (err: any) {
    console.error("Crypto error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
