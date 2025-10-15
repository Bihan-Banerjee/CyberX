import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const OSFingerprint: React.FC = () => {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!target.trim()) {
      setError("Please enter a valid IP address or domain!");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await axios.post("http://localhost:8787/api/osfingerprint", {
        target,
      });
      setResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to detect OS");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTarget("");
    setResult(null);
    setError(null);
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🛰 CyberX OS Fingerprinting"
        message="Enter a target IP or domain to detect the operating system using active & passive scanning techniques."
        confirmText={loading ? "Scanning..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleScan}
        onCancel={handleReset}
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

          {/* Error */}
          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {/* Results */}
          {!loading && result && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)]">
              <h2 className="text-xl font-semibold mb-3 text-red-400 tracking-wide">
                Detected OS
              </h2>

              {/* Exact OS Match */}
              <p className="text-gray-300 text-base">
                {result.osDetails || (
                  <span className="text-gray-500 italic">
                    No exact match found.
                  </span>
                )}
              </p>

              {/* Possible Matches */}
              {result.osGuesses && result.osGuesses.length > 0 && (
                <>
                  <h3 className="mt-4 mb-2 text-red-300 text-lg">
                    Possible Matches:
                  </h3>
                  <ul className="space-y-2 list-disc list-inside text-gray-300">
                    {result.osGuesses.map((os: string, idx: number) => (
                      <li
                        key={idx}
                        className="bg-zinc-900/30 px-4 py-2 rounded-lg border border-zinc-700 hover:border-red-500 transition"
                      >
                        {os}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Raw Nmap Output */}
              {result.raw && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-red-400 hover:underline">
                    View Raw Nmap Output
                  </summary>
                  <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-red-500 text-gray-300 overflow-x-auto text-sm">
                    {result.raw}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default OSFingerprint;
