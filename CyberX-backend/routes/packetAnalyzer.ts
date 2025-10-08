// CyberX-backend/routes/packetAnalyzer.ts
import { Router } from "express";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const router = Router();
const execp = promisify(exec);

// Helper: safe temp file
function tmpFile(prefix = "cyberx-pcap-") {
  const fn = prefix + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".pcap";
  return path.join(os.tmpdir(), fn);
}

// Sanitize simple strings (very conservative)
function sanitizeAlphaNumDash(s: string) {
  return String(s).replace(/[^\w\-\.]/g, "");
}

/**
 * GET /api/packet-analyzer/interfaces
 * returns list of available capture interfaces (requires tshark)
 */
router.get("/interfaces", async (req, res) => {
  try {
    // tshark -D lists interfaces
    const { stdout } = await execp("tshark -D");
    // each line: 1. \Device\...\n or "1. eth0"
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const ifaces = lines.map((l) => {
      const parts = l.split(/\s+/);
      // join remainder as human name
      const index = parts[0].replace(/\.$/, "");
      const name = l.replace(/^\s*\d+\.\s*/, "").trim();
      return { index, name, raw: name };
    });
    res.json({ ok: true, interfaces: ifaces });
  } catch (e: any) {
    console.error("interfaces error:", e?.message || e);
    res.status(500).json({ error: "Could not list capture interfaces. Ensure tshark is installed and in PATH." });
  }
});

/**
 * POST /api/packet-analyzer/upload
 * Accepts multipart upload (pcap file) or base64 body; here we support a buffer upload via multer.
 * For simplicity assume front-end sends FormData with field "pcap"
 */
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/upload", upload.single("pcap"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "pcap file required (field 'pcap')" });

    // save to tmp file
    const out = tmpFile("uploaded-");
    fs.writeFileSync(out, req.file.buffer);

    // parse with tshark to JSON
    // -T json gives array of packet objects
    const cmd = `tshark -r "${out}" -T json`;
    const { stdout } = await execp(cmd, { maxBuffer: 1024 * 1024 * 12 });

    // remove tmp file
    try { fs.unlinkSync(out); } catch {/* ignore */}

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      console.error("tshark parse error:", e);
      return res.status(500).json({ error: "Failed to parse pcap (tshark output invalid)" });
    }

    // summarize basic info (top protocols, top talkers)
    const summary = summarizeTsharkJson(parsed);
    res.json({ ok: true, summary, packets: parsed.slice(0, 250) }); // cap packets returned
  } catch (e: any) {
    console.error("upload error:", e);
    res.status(500).json({ error: e?.message || "upload/parse failed" });
  }
});

/**
 * POST /api/packet-analyzer/live
 * body: { iface: string, filter?: string, duration?: number, count?: number }
 * Runs tshark capture for given duration into a temp pcap then parses it.
 */
router.post("/live", async (req, res) => {
  try {
    const { iface, filter, duration = 5, count } = req.body || {};
    if (!iface) return res.status(400).json({ error: "iface required" });

    // basic sanitize
    const sIface = sanitizeAlphaNumDash(String(iface));
    const sFilter = typeof filter === "string" ? filter.replace(/["'`]/g, "") : "";
    const sDuration = Number(duration) || 5;
    const sCount = count ? Number(count) : 0;

    const out = tmpFile("live-");

    // Build tshark capture command:
    // -i iface -a duration:NN -w out.pcap (or -c count) (we use -F pcap)
    let captureCmd = `tshark -i "${sIface}" -w "${out}" -F pcap -q`;
    if (sCount > 0) captureCmd = `tshark -i "${sIface}" -c ${sCount} -w "${out}" -F pcap -q`;
    else captureCmd = `tshark -i "${sIface}" -a duration:${sDuration} -w "${out}" -F pcap -q`;

    if (sFilter) {
      // capture filter needs -f (BPF) or apply display filter while reading: we'll use -f (BPF)
      captureCmd = captureCmd.replace("-w", `-f "${sFilter}" -w`);
    }

    // Run capture (this requires tshark + permissions)
    await execp(captureCmd, { timeout: (sDuration + 10) * 1000, maxBuffer: 1024 * 1024 * 8 });

    // Parse with tshark
    const { stdout } = await execp(`tshark -r "${out}" -T json`, { maxBuffer: 1024 * 1024 * 12 });

    // cleanup
    try { fs.unlinkSync(out); } catch (_) {}

    const parsed = JSON.parse(stdout || "[]");
    const summary = summarizeTsharkJson(parsed);
    res.json({ ok: true, summary, packets: parsed.slice(0, 200) });
  } catch (e: any) {
    console.error("live capture error:", e);
    res.status(500).json({ error: "Live capture failed: " + (e?.message || e) });
  }
});

export default router;

/**
 * Helper to build a small summary from tshark JSON packets
 */
function summarizeTsharkJson(packets: any[]) {
  const protoCount: Record<string, number> = {};
  const talkers: Record<string, number> = {}; // by src ip
  const dsts: Record<string, number> = {};

  for (const p of packets) {
    try {
      const layers = p._source?.layers || p._source || {};
      // protocol: try highest-level proto name
      const frameProto = layers.frame?.frame_protocols || layers.frame_protocols || "";
      const protos = String(frameProto).split(":").filter(Boolean);
      const topProto = protos[protos.length - 1] || "unknown";
      protoCount[topProto] = (protoCount[topProto] || 0) + 1;

      // src/dst ip
      const ipSrc = layers.ip?.ip_src || layers["ip.src"] || layers["ip.src_host"];
      const ipDst = layers.ip?.ip_dst || layers["ip.dst"] || layers["ip.dst_host"];
      const src = ipSrc || (layers["eth.src"] || "").split(",")[0];
      const dst = ipDst || (layers["eth.dst"] || "").split(",")[0];

      if (src) talkers[src] = (talkers[src] || 0) + 1;
      if (dst) dsts[dst] = (dsts[dst] || 0) + 1;
    } catch (_) {
      // ignore
    }
  }

  const topProtocols = Object.entries(protoCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topTalkers = Object.entries(talkers).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topDests = Object.entries(dsts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return { totalPackets: packets.length, topProtocols, topTalkers, topDests };
}
