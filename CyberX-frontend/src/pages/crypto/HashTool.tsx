import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const HashTool: React.FC = () => {
  const [text, setText] = useState("");
  const [algorithm, setAlgorithm] = useState<"md5"|"sha1"|"sha256"|"sha512">("sha256");
  const [digest, setDigest] = useState<string| null>(null);

  // cracking
  const [targetHash, setTargetHash] = useState("");
  const [wordlistText, setWordlistText] = useState(""); // newline list optional
  const [maxAttempts, setMaxAttempts] = useState(20000);
  const [crackResult, setCrackResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const handleGenerate = async () => {
    setError(null);
    try {
      const resp = await axios.post("http://localhost:8787/api/hash/generate", { algorithm, text });
      setDigest(resp.data.digest);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message);
    }
  };

  const handleCrack = async () => {
    setError(null);
    setCrackResult(null);

    if (!targetHash) { setError("Enter target hash"); return; }
    if (!wordlistText.trim()) { setError("Provide candidate words (one per line) for the demo"); return; }

    setLoading(true);
    try {
      // use inline candidates (safe for demo). For huge lists, upload/write to server and pass path.
      const candidates = wordlistText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 200000);
      const resp = await axios.post("http://localhost:8787/api/hash/crack", {
        algorithm,
        targetHash,
        candidates,
        maxAttempts,
        timeoutMs: 60_000
      }, { timeout: 120000 });
      setCrackResult(resp.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10">
      <CyberpunkCard
        title="🔐 Hash Generator & Cracker"
        message="Generate or try to crack test hashes. Use only for authorized testing. Dictionary attack only."
        confirmText="Generate Hash"
        cancelText="Clear"
        onConfirm={handleGenerate}
        onCancel={() => { setText(""); setDigest(null); setError(null); }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.7}
        showBackground={false}
        width={900}
      >
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-3">
            <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as any)} className="col-span-1 p-3 rounded-lg bg-black/20 border border-red-500 text-white">
              <option value="md5">MD5</option>
              <option value="sha1">SHA1</option>
              <option value="sha256">SHA256</option>
              <option value="sha512">SHA512</option>
            </select>
            <input type="text" placeholder="Text to hash" value={text} onChange={(e) => setText(e.target.value)} className="col-span-2 p-3 rounded-lg bg-black/20 border border-zinc-700 text-white" />
          </div>

          <div>
            <button onClick={handleGenerate} className="bg-red-500 px-4 py-2 rounded mr-2">{/* Generate */}Generate</button>
            {digest && <span className="ml-4 text-sm break-all text-green-300">Digest: <code>{digest}</code></span>}
          </div>

          <hr className="border-t border-zinc-700" />

          <h4 className="text-lg font-semibold">Crack (dictionary)</h4>
          <p className="text-sm text-gray-400">Paste candidate words (one per line) or use server-side wordlist (advanced).</p>

          <div>
            <input type="text" placeholder="Target hash to crack" value={targetHash} onChange={(e) => setTargetHash(e.target.value)} className="w-full p-3 rounded-lg bg-black/20 border border-zinc-700 text-white mb-2" />
            <textarea placeholder="Candidates (one per line) — small lists only in browser demo" value={wordlistText} onChange={(e) => setWordlistText(e.target.value)} rows={6} className="w-full p-3 rounded-lg bg-black/20 border border-zinc-700 text-white"></textarea>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300">Max attempts</label>
            <input type="number" min={10} max={500000} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} className="p-2 rounded bg-black/20 border border-zinc-700 w-28" />
            <button onClick={handleCrack} disabled={loading} className="ml-auto bg-indigo-600 px-4 py-2 rounded">{loading ? "Running..." : "Start Crack"}</button>
          </div>

          {error && <p className="text-red-400">{error}</p>}

          {crackResult && (
            <div className="bg-black/10 rounded p-3 border border-red-500 mt-2">
              <div>Attempts: <b>{crackResult.attempts}</b> • Elapsed: <b>{crackResult.elapsedMs}ms</b></div>
              {crackResult.found ? (
                <div className="mt-2 text-green-300">Found candidate: <code>{crackResult.found.candidate}</code></div>
              ) : (
                <div className="mt-2 text-yellow-300">No match found in provided candidates.</div>
              )}
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default HashTool;
