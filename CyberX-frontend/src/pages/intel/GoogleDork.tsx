import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";

export default function GoogleDork() {
  const [dorksText, setDorksText] = useState(""); // newline-separated dorks
  const [maxResults, setMaxResults] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any> | null>(null);

  const runQueries = async () => {
    setError(null);
    setResults(null);

    const dorks = dorksText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (dorks.length === 0) return setError("Enter one or more dork queries (one per line)");

    setLoading(true);
    try {
      const resp = await fetch("http://localhost:8787/api/google-dork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dorks, maxResults }),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || `Server ${resp.status}`);
      setResults(j.results || {});
    } catch (err: any) {
      setError(err.message || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🔎 Google Dorking Automation"
        message="Run curated Google dork queries via Google Custom Search API. Use responsibly — only target assets you own or have permission for."
        confirmText={loading ? "Searching..." : "Run Dorks"}
        cancelText="Reset"
        onConfirm={runQueries}
        onCancel={() => { setDorksText(""); setMaxResults(5); setError(null); setResults(null); }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={920}
      >
        <div className="space-y-4 mt-4">
          <textarea
            value={dorksText}
            onChange={(e) => setDorksText(e.target.value)}
            placeholder={`Enter one dork per line — e.g.\nsite:example.com ext:pdf "password"\nintitle:"index of /admin"`}
            rows={6}
            className="w-full p-3 rounded bg-black/20 border border-red-500 text-white"
          />

          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300">Max results per dork</label>
            <input
              type="number"
              min={1}
              max={5}
              value={maxResults}
              onChange={(e) => setMaxResults(Math.max(1, Math.min(5, Number(e.target.value))))}
              className="w-20 p-2 rounded bg-black/20 border border-zinc-700 text-white"
            />
            <p className="text-xs text-gray-400 ml-auto">Max 5 dorks, 5 results each. Official API only — no scraping.</p>
          </div>

          {error && <p className="text-red-400">{error}</p>}

          {results && (
            <div className="bg-black/10 rounded p-3 border border-red-500 mt-2 max-h-[420px] overflow-y-auto">
              {Object.keys(results).map((dork) => (
                <div key={dork} className="mb-4">
                  <div className="font-semibold text-red-300 mb-2">{dork}</div>

                  {results[dork].error ? (
                    <div className="text-sm text-yellow-300">Error: {JSON.stringify(results[dork].error)}</div>
                  ) : (
                    <ul className="space-y-2">
                      {results[dork].items.map((it: any, i: number) => (
                        <li key={i} className="p-2 rounded bg-zinc-900/30 border border-zinc-700">
                          <a href={it.link} target="_blank" rel="noreferrer" className="text-red-400 font-medium break-all">
                            {it.title || it.link}
                          </a>
                          <div className="text-sm text-gray-400">{it.snippet}</div>
                          <div className="text-xs text-gray-500 mt-1">{it.displayLink}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
}
