import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

type Result = {
  name: string;
  provider: string;
  url: string;
  status?: number | null;
  error?: string | null;
  hints?: string[];
  likelyPublic?: boolean;
};

const BucketFinder: React.FC = () => {
  const [namesText, setNamesText] = useState("");
  const [providers, setProviders] = useState({ aws: true, gcp: true, azure: true });
  const [concurrency, setConcurrency] = useState(6);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setError(null);
    setResults([]);
    let names = namesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    try {
      setLoading(true);
      const resp = await axios.post("http://localhost:8787/api/bucket-finder", {
        names,
        providers: Object.keys(providers).filter(k => (providers as any)[k]),
        concurrency,
        useDefault: names.length === 0,
      }, { timeout: 120000 });

      setResults(resp.data.results || []);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Bucket scan failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10">
      <CyberpunkCard
        title="🪣 Bucket Finder"
        message="Search for misconfigured public storage buckets (AWS / GCP / Azure). Use responsibly."
        confirmText={loading ? "Scanning..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleRun}
        onCancel={() => {
          setNamesText("");
          setResults([]);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <textarea
            value={namesText}
            onChange={(e) => setNamesText(e.target.value)}
            placeholder="Enter bucket names (one per line). Leave blank to use default list."
            rows={4}
            className="w-full p-3 rounded-lg bg-black/20 border border-zinc-700 text-white"
          />

          <div className="flex gap-3 items-center">
            <label className="text-sm text-gray-300">Providers:</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={providers.aws} onChange={(e) => setProviders({...providers, aws: e.target.checked})} /> AWS</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={providers.gcp} onChange={(e) => setProviders({...providers, gcp: e.target.checked})} /> GCP</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={providers.azure} onChange={(e) => setProviders({...providers, azure: e.target.checked})} /> Azure</label>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-sm text-gray-300">Concurrency</label>
              <input type="number" min={1} max={40} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-20 p-2 rounded bg-black/20 border border-zinc-700 text-white" />
            </div>
          </div>

          {error && <p className="text-red-400">{error}</p>}

          {!loading && results.length > 0 && (
            <div className="bg-black/10 rounded-lg p-3 border border-red-500 max-h-80 overflow-y-auto">
              <h3 className="text-lg text-red-400 mb-3">Findings</h3>
              <ul className="space-y-2">
                {results.map((r, i) => (
                  <li key={i} className={"p-2 rounded bg-zinc-900/30 border border-zinc-700 flex justify-between items-start"}>
                    <div className="break-words">
                      <div className="text-sm text-gray-300">{r.name} — <span className="text-xs text-gray-400">{r.provider}</span></div>
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-red-400 break-all">{r.url}</a>
                      <div className="text-xs text-gray-500">Status: {r.status ?? "—"} {r.error ? `| Error: ${r.error}` : ""}</div>
                      <div className="text-xs text-gray-400">Hints: {r.hints?.join(", ") || "none"}</div>
                    </div>
                    <div className="ml-4">
                      {r.likelyPublic ? <span className="text-green-400 font-semibold">PUBLIC</span> : <span className="text-yellow-300">private/unknown</span>}
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

export default BucketFinder;
