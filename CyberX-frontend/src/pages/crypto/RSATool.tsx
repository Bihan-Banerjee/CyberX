import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";

export default function RSATool() {
  const [mode, setMode] = useState<"encrypt" | "decrypt">("encrypt");
  const [algo, setAlgo] = useState<"aes" | "rsa">("aes");
  const [inputText, setInputText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");
  const [key, setKey] = useState("");

  async function handleSubmit() {
    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("algo", algo);
    formData.append("key", key);
    if (file) formData.append("file", file);
    else formData.append("text", inputText);

    try {
      const res = await fetch("http://localhost:8787/api/crypto", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        setResult(`Error: ${res.status}`);
        return;
      }

      if (file) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = mode === "encrypt" ? "encrypted.bin" : "decrypted.bin";
        a.click();
      } else {
        const text = await res.text();
        setResult(text);
      }
    } catch (err: any) {
      setResult("Error: " + err.message);
    }
  }

  return (
    <div className="flex justify-center pt-10">
      <CyberpunkCard
        title="🔑 RSA / AES Encryption & Decryption"
        message="Encrypt or decrypt text/files using AES or RSA."
        confirmText="Run"
        cancelText="Clear"
        onConfirm={handleSubmit}
        onCancel={() => {
          setInputText("");
          setResult("");
          setFile(null);
        }}
        width={920}
        red="#ff2b45"
        deepRed="#d50f2f"
      >
        <div className="space-y-4 mt-4">
          <div className="flex gap-4">
            <select
              value={algo}
              onChange={(e) => setAlgo(e.target.value as any)}
              className="p-2 rounded bg-black/20 border border-red-500 text-white"
            >
              <option value="aes">AES (symmetric)</option>
              <option value="rsa">RSA (asymmetric)</option>
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="p-2 rounded bg-black/20 border border-red-500 text-white"
            >
              <option value="encrypt">Encrypt</option>
              <option value="decrypt">Decrypt</option>
            </select>
          </div>

          <input
            className="w-full p-2 rounded bg-black/20 border border-zinc-700 text-white"
            placeholder="Enter secret key or RSA PEM key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />

          <textarea
            className="w-full p-3 rounded bg-black/20 border border-zinc-700 text-white"
            rows={4}
            placeholder="Enter text (or upload file below)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />

          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />

          <div className="bg-black/10 rounded p-3 border border-red-500">
            <label className="text-sm text-gray-300">Result</label>
            <textarea
              readOnly
              rows={6}
              value={result}
              className="w-full p-3 rounded bg-transparent border-none text-white"
            />
          </div>
        </div>
      </CyberpunkCard>
    </div>
  );
}
