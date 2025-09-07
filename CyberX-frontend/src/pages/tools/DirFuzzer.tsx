import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const DirFuzzer: React.FC = () => {
  const [target, setTarget] = useState("");
  const [pathsText, setPathsText] = useState(""); // custom newline list
  const [extensions, setExtensions] = useState("php,html,bak,old,txt");
  const [concurrency, setConcurrency] = useState(25);
  const [delayMs, setDelayMs] = useState(50);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
  if (!target.trim()) {
    setError("Please enter a target host or URL (e.g. example.com or https://example.com)");
    return;
  }

  // ✅ Auto-add https:// if missing
  let finalTarget = target.trim();
  if (!/^https?:\/\//i.test(finalTarget)) {
    finalTarget = `https://${finalTarget}`;
  }

  setLoading(true);
  setError(null);
  setResults([]);
  setStats(null);

  try {
    const payload = {
      target: finalTarget,
      paths: pathsText,
      useDefault: true,
      extensions,
      method: "HEAD",
      concurrency,
      delayMs,
      timeoutMs: 5000,
      followRedirects: false,
    };

    const resp = await axios.post(
      "http://localhost:8787/api/dir-fuzzer",
      payload,
      { timeout: 120000 }
    );

    setResults(resp.data.found || []);
    setStats({
      tried: resp.data.tried,
      processed: resp.data.processed,
      foundCount: resp.data.foundCount,
    });
  } catch (err: any) {
    setError(err.response?.data?.error || err.message || "Fuzz failed");
  } finally {
    setLoading(false);
  }
};


  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="📂 Directory & File Fuzzer"
        message="Discover hidden directories/endpoints. Use responsibly — only test targets you own or are authorized to test."
        confirmText={loading ? "Fuzzing..." : "Start Fuzz"}
        cancelText="Reset"
        onConfirm={handleRun}
        onCancel={() => {
          setTarget("");
          setPathsText("");
          setExtensions("php,html,bak,old,txt");
          setResults([]);
          setStats(null);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <input
            type="text"
            placeholder="Target (domain or full url) — e.g. example.com or https://example.com"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          <textarea
            placeholder="Custom paths (one per line). Leave empty to use default wordlist."
            value={pathsText}
            onChange={(e) => setPathsText(e.target.value)}
            rows={4}
            className="w-full p-3 rounded-lg bg-black/20 border border-zinc-700 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Extensions (comma separated)"
              value={extensions}
              onChange={(e) => setExtensions(e.target.value)}
              className="p-3 rounded-lg bg-black/20 border border-zinc-700 text-white"
            />
            <input
              type="number"
              min={1}
              max={200}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="p-3 rounded-lg bg-black/20 border border-zinc-700 text-white"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300">Delay ms</label>
            <input
              type="number"
              min={0}
              max={5000}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="p-2 rounded-lg bg-black/20 border border-zinc-700 text-white w-28"
            />
            <span className="ml-auto text-sm text-gray-400">
              Use HEAD requests by default — change backend to GET for content.
            </span>
          </div>

          {error && <p className="text-red-400">{error}</p>}

          {!loading && stats && (
            <div className="bg-black/10 rounded-lg p-3 border border-red-500">
              <div className="flex gap-4">
                <div>Attempted: <b>{stats.tried}</b></div>
                <div>Processed: <b>{stats.processed}</b></div>
                <div>Found: <b>{stats.foundCount}</b></div>
              </div>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="bg-black/10 rounded-lg p-3 border border-red-500 max-h-80 overflow-y-auto">
              <ul className="space-y-2">
                {results.map((r, i) => (
                  <li key={i} className="p-2 rounded bg-zinc-900/30 border border-zinc-700">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm text-gray-300">{r.path}</div>
                        <a className="text-red-400 break-all" href={r.url} target="_blank" rel="noreferrer">
                          {r.url}
                        </a>
                        <div className="text-xs text-gray-500">Status: {r.status} — Length: {r.length}</div>
                      </div>
                      <div className="text-xs text-gray-400">{r.elapsedMs}ms</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default DirFuzzer;
