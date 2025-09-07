import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const ServiceDetection: React.FC = () => {
  const [target, setTarget] = useState("");
  const [ports, setPorts] = useState("1-1000");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<
    { port: string; protocol: string; service: string; version: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!target) {
      setError("Please enter a valid target host/IP.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await axios.post("http://localhost:8787/api/service-detect", {
        target,
        ports,
      });
      setResults(response.data.results || []);
    } catch (err: any) {
      setError("Failed to detect services. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🛰️ Service & Version Detection"
        message="Enter a target IP/domain and optional port range to identify services and versions."
        confirmText={loading ? "Scanning..." : "Start Detection"}
        cancelText="Reset"
        onConfirm={handleScan}
        onCancel={() => {
          setTarget("");
          setPorts("1-1000");
          setResults([]);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={750}
      >
        {/* Input Fields */}
        <div className="space-y-5 mt-4">
          {/* Target Input */}
          <input
            type="text"
            placeholder="Enter target IP or domain (e.g. scanme.nmap.org)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {/* Ports Input */}
          <input
            type="text"
            placeholder="Enter port range (e.g. 1-1000)"
            value={ports}
            onChange={(e) => setPorts(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {/* Error */}
          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {/* Results */}
          {!loading && results.length > 0 && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)]">
              <h2 className="text-xl font-semibold mb-3 text-red-400 tracking-wide">
                Detected Services ({results.length})
              </h2>
              <ul className="space-y-3">
                {results.map((res, idx) => (
                  <li
                    key={idx}
                    className="bg-zinc-900/30 px-4 py-3 rounded-lg border border-zinc-700 hover:border-red-500 transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between">
                      <span className="font-semibold">
                        Port{" "}
                        <span className="text-red-400">{res.port}</span> (
                        {res.protocol.toUpperCase()})
                      </span>
                      <span className="text-gray-300">
                        {res.service} — <span className="text-red-400">{res.version}</span>
                      </span>
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

export default ServiceDetection;
