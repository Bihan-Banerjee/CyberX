import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const BrokenAuth: React.FC = () => {
  const [loginUrl, setLoginUrl] = useState("");
  const [protectedUrl, setProtectedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!loginUrl.trim()) {
      setError("Please enter a login URL");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const resp = await axios.post("http://localhost:8787/api/broken-auth", {
        loginUrl,
        protectedUrl,
      });
      setResults(resp.data.results);
    } catch (err: any) {
      setError(err.response?.data?.error || "Broken Auth check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🔓 Broken Auth Detector"
        message="Analyze login flows and check for authentication bypass flaws."
        confirmText={loading ? "Scanning..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleScan}
        onCancel={() => {
          setLoginUrl("");
          setProtectedUrl("");
          setResults(null);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={850}
      >
        <div className="space-y-4 mt-4">
          <input
            type="text"
            placeholder="Login URL (e.g. https://example.com/login)"
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          <input
            type="text"
            placeholder="Protected URL (optional, e.g. https://example.com/dashboard)"
            value={protectedUrl}
            onChange={(e) => setProtectedUrl(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-zinc-700 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {!loading && results && (
            <div className="bg-black/10 rounded-lg p-4 border border-red-500 space-y-3">
              <h2 className="text-xl font-semibold text-red-400 tracking-wide">
                Authentication Scan Results
              </h2>
              <ul className="space-y-2">
                {Object.entries(results).map(([key, value]) => (
                  <li
                    key={key}
                    className="bg-zinc-900/30 px-4 py-2 rounded-lg border border-zinc-700 hover:border-red-500 transition"
                  >
                    <b className="capitalize">{key}:</b> {String(value)}
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

export default BrokenAuth;
