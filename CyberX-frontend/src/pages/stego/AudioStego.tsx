import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";

export default function AudioStego() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleEmbed = async () => {
    setError(null); setInfo(null); setExtracted(null);
    if (!file) return setError("Select a WAV file first");
    if (!message) return setError("Enter a message");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("audio", file);
      fd.append("message", message);

      const resp = await fetch("http://localhost:8787/api/stego-audio/embed", { method: "POST", body: fd });
      if (!resp.ok) {
        const j = await resp.json().catch(() => null);
        throw new Error(j?.error || "Embed failed");
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "stego.wav"; a.click();
      setInfo("Stego WAV downloaded");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExtract = async () => {
    setError(null); setInfo(null); setExtracted(null);
    if (!file) return setError("Select a WAV file first");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("audio", file);
      const resp = await fetch("http://localhost:8787/api/stego-audio/extract", { method: "POST", body: fd });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || "Extract failed");
      setExtracted(j.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10">
      <CyberpunkCard
        title="🎵 Audio Steganography"
        message="Hide messages inside WAV audio using LSB encoding."
        confirmText={loading ? "Working..." : "Embed"}
        cancelText="Reset"
        onConfirm={handleEmbed}
        onCancel={() => { setFile(null); setMessage(""); setError(null); setInfo(null); setExtracted(null); }}
        red="#ff2b45" deepRed="#d50f2f" panelAlpha={0.65} showBackground={false} width={820}
      >
        <div className="space-y-4 mt-4">
          <input type="file" accept="audio/wav" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <textarea
            placeholder="Secret message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full p-3 rounded bg-black/20 border border-red-500 text-white"
          />
          <div className="flex gap-3">
            <button onClick={handleEmbed} className="bg-red-500 px-4 py-2 rounded">Embed & Download</button>
            <button onClick={handleExtract} className="bg-zinc-800 px-4 py-2 rounded">Extract</button>
          </div>
          {error && <p className="text-red-400">{error}</p>}
          {info && <p className="text-green-300">{info}</p>}
          {extracted && (
            <div className="bg-black/10 border border-red-500 rounded p-3">
              <h4 className="font-semibold mb-2">Extracted Message</h4>
              <pre className="whitespace-pre-wrap text-sm">{extracted}</pre>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
}
