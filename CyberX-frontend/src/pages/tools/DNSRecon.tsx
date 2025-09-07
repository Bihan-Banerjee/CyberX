import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const DNSRecon: React.FC = () => {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async () => {
    if (!domain.trim()) {
      setError("Please enter a valid domain.");
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await axios.post("http://localhost:8787/api/dnsrecon", { domain });
      setData(response.data.records);
    } catch (err: any) {
      setError("DNS recon failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setDomain("");
    setData(null);
    setError(null);
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🌐 DNS Recon Tool"
        message="Fetch DNS records including A, AAAA, MX, TXT, CNAME, NS, and SOA."
        confirmText={loading ? "Fetching..." : "Lookup"}
        cancelText="Reset"
        onConfirm={handleLookup}
        onCancel={handleReset}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={750}
      >
        <div className="space-y-5 mt-4">
          {/* Domain Input */}
          <input
            type="text"
            placeholder="Enter domain (e.g. example.com)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {/* Error */}
          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {/* Results */}
          {!loading && data && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)] max-h-[400px] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-3 text-red-400 tracking-wide">
                DNS Records
              </h2>
              <ul className="space-y-3 text-sm text-gray-300">
                {Object.entries(data).map(([key, value]) => (
                  <li key={key} className="border-b border-zinc-700 pb-2">
                    <span className="font-semibold text-red-400">{key}:</span>{" "}
                    <pre className="bg-black/20 p-2 rounded text-gray-200 mt-1 whitespace-pre-wrap break-all">
                      {JSON.stringify(value, null, 2)}
                    </pre>
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

export default DNSRecon;
