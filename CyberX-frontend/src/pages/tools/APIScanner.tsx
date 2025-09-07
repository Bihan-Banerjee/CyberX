import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const APIScanner: React.FC = () => {
  const [baseUrl, setBaseUrl] = useState("");
  const [pathsText, setPathsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!baseUrl.trim()) {
      setError("Please enter a valid base URL");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    setStats(null);

    try {
      const resp = await axios.post("http://localhost:8787/api/api-scanner", {
        baseUrl,
        paths: pathsText,
        useDefault: true,
      });

      setResults(resp.data.results || []);
      setStats({
        tried: resp.data.tried,
        validCount: resp.data.validCount,
        forbiddenCount: resp.data.forbiddenCount,
        missingCount: resp.data.missingCount,
      });
    } catch (err: any) {
      setError(err.response?.data?.error || "API scanning failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🔍 API Endpoint Scanner"
        message="Discover hidden API endpoints. Use responsibly on authorized targets."
        confirmText={loading ? "Scanning..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleScan}
        onCancel={() => {
          setBaseUrl("");
          setPathsText("");
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
            placeholder="Enter base URL (e.g. https://example.com/)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          <textarea
            placeholder="Custom paths (one per line). Leave empty to use default wordlist."
            value={pathsText}
            onChange={(e) => setPathsText(e.target.value)}
            rows={4}
            className="w-full p-3 rounded-lg bg-black/20 border border-zinc-700 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {error && <p className="text-red-400">{error}</p>}

          {!loading && stats && (
            <div className="bg-black/10 rounded-lg p-3 border border-red-500">
              <div className="flex gap-4">
                <div>Attempted: <b>{stats.tried}</b></div>
                <div>Valid: <b>{stats.validCount}</b></div>
                <div>Forbidden: <b>{stats.forbiddenCount}</b></div>
                <div>Missing: <b>{stats.missingCount}</b></div>
              </div>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="bg-black/10 rounded-lg p-3 border border-red-500 max-h-80 overflow-y-auto">
              <ul className="space-y-2">
                {results.map((r, i) => (
                  <li key={i} className="p-2 rounded bg-zinc-900/30 border border-zinc-700">
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-red-400 break-all">
                      {r.url}
                    </a>
                    <div className="text-xs text-gray-500">
                      Status: {r.status} | Type: {r.contentType} | Size: {r.length} bytes
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

export default APIScanner;
