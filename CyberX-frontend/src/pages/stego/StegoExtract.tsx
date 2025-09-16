import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";
import axios from "axios";

export default function StegoExtract() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [byteLength, setByteLength] = useState<number | null>(null);
  const [rawData, setRawData] = useState<Uint8Array | null>(null);

  const handleExtract = async () => {
    setError(null);
    setMessage(null);
    setByteLength(null);
    setRawData(null);
    if (!file) return setError("Choose a file first");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const resp = await axios.post("http://localhost:8787/api/stego-extract", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "json",
      });

      if (resp.data && resp.data.success) {
        setMessage(resp.data.message ?? null);
        setByteLength(resp.data.byteLength ?? null);
        // If server returned raw bytes later, we could accept ArrayBuffer; here we get text
      } else {
        setError("No payload found");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Extraction failed");
    } finally {
      setLoading(false);
    }
  };

  // Download raw bytes (if you want to request raw binary from backend modify backend to send as blob)
  const downloadRaw = () => {
    if (!rawData) return;
    const blob = new Blob([rawData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "extracted.bin";
    a.click();
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🔎 Stego Extractor"
        message="Upload a PNG (image LSB) or WAV (audio LSB). This will attempt to extract an embedded payload (32-bit length + data)."
        confirmText={loading ? "Working..." : "Extract"}
        cancelText="Reset"
        onConfirm={handleExtract}
        onCancel={() => { setFile(null); setError(null); setMessage(null); setByteLength(null); setRawData(null); }}
        red="#ff7a4d"
        deepRed="#d1442a"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <input type="file" accept=".png,audio/wav" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {error && <p className="text-red-400">{error}</p>}
          {message !== null && (
            <div className="bg-black/10 rounded p-3 border border-red-500">
              <h4 className="font-semibold">Extracted (text)</h4>
              <pre className="whitespace-pre-wrap text-sm text-gray-200">{message}</pre>
              <div className="mt-2 text-sm text-gray-400">Bytes: {byteLength}</div>
            </div>
          )}
          {rawData && (
            <div>
              <button onClick={downloadRaw} className="bg-red-500 px-4 py-2 rounded">Download Raw</button>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
}
