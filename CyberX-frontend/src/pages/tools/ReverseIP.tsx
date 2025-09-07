import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const ReverseIP: React.FC = () => {
  const [ip, setIp] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async () => {
    if (!ip) {
      setError("Please enter a valid IP address.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await axios.post("http://localhost:8787/api/reverse-ip", { ip });
      setResults(response.data.domains || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch reverse IP data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🌐 Reverse IP Lookup"
        message="Find other domains hosted on the same IP."
        confirmText={loading ? "Searching..." : "Start Lookup"}
        cancelText="Reset"
        onConfirm={handleLookup}
        onCancel={() => {
          setIp("");
          setResults([]);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={750}
      >
        <div className="space-y-5 mt-4">
          <input
            type="text"
            placeholder="Enter IP address (e.g. 8.8.8.8)"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {!loading && results.length > 0 && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)]">
              <h2 className="text-xl font-semibold mb-3 text-red-400 tracking-wide">
                Found {results.length} Domains
              </h2>
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {results.map((domain, idx) => (
                  <li
                    key={idx}
                    className="bg-zinc-900/30 px-4 py-2 rounded-lg border border-zinc-700 hover:border-red-500 transition"
                  >
                    {domain}
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

export default ReverseIP;
