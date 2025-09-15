import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";

export default function ImageStego() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracted, setExtracted] = useState<string | null>(null);

  const handleEmbed = async () => {
    setError(null);
    setInfo(null);
    setExtracted(null);
    if (!file) return setError("Choose a PNG image first");
    if (!message) return setError("Enter a message to embed");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("message", message);

      const resp = await fetch("http://localhost:8787/api/stego-image/embed", {
        method: "POST",
        body: fd,
      });

      if (!resp.ok) {
        const j = await resp.json().catch(() => null);
        throw new Error(j?.error || `Server returned ${resp.status}`);
      }

      // get blob and download
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "stego.png";
      a.click();
      setInfo("Stego image downloaded as stego.png");
    } catch (err: any) {
      setError(err.message || "Embed failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExtract = async () => {
    setError(null);
    setInfo(null);
    setExtracted(null);
    if (!file) return setError("Choose a PNG image first");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);

      const resp = await fetch("http://localhost:8787/api/stego-image/extract", {
        method: "POST",
        body: fd,
      });

      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || `Server ${resp.status}`);
      setExtracted(j.message);
    } catch (err: any) {
      setError(err.message || "Extract failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🖼️ Image Steganography"
        message="Embed/extract secret messages in PNG images (lossless). JPEG not supported — convert to PNG first."
        confirmText={loading ? "Working..." : "Embed Message"}
        cancelText="Reset"
        onConfirm={handleEmbed}
        onCancel={() => { setFile(null); setMessage(""); setError(null); setInfo(null); setExtracted(null); }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <input
            type="file"
            accept="image/png"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setInfo(null); setExtracted(null); }}
            className="w-full"
          />
          <textarea
            placeholder="Secret message to embed (UTF-8)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full p-3 rounded bg-black/20 border border-red-500 text-white"
          />

          <div className="flex gap-3">
            <button onClick={handleEmbed} className="bg-red-500 px-4 py-2 rounded">Embed & Download</button>
            <button onClick={handleExtract} className="bg-zinc-800 px-4 py-2 rounded">Extract Message</button>
          </div>

          {error && <p className="text-red-400">{error}</p>}
          {info && <p className="text-green-300">{info}</p>}
          {extracted !== null && (
            <div className="bg-black/10 rounded p-3 border border-red-500 mt-2">
              <h4 className="text-lg font-semibold">Extracted Message</h4>
              <pre className="whitespace-pre-wrap text-sm text-gray-200">{extracted}</pre>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
}
