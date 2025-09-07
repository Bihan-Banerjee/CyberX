import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const VulnFuzzer: React.FC = () => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!url.trim()) {
      setError("Please enter a valid URL with query params.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const resp = await axios.post("http://localhost:8787/api/vuln-fuzzer", {
        url,
        tests: ["sqli", "xss", "rce", "ssrf"],
      });
      setResults(resp.data.results);
    } catch (err: any) {
      setError(err.response?.data?.error || "Fuzzing failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🧪 Vulnerability Fuzzer"
        message="Automatically test for SQLi, XSS, RCE, SSRF, and more."
        confirmText={loading ? "Fuzzing..." : "Start Fuzzing"}
        cancelText="Reset"
        onConfirm={handleRun}
        onCancel={() => {
          setUrl("");
          setResults(null);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={800}
      >
        <div className="space-y-5 mt-4">
          <input
            type="text"
            placeholder="Enter URL with query params (e.g. https://testphp.vulnweb.com/listproducts.php?cat=1)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {!loading && results && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)] max-h-80 overflow-y-auto">
              {Object.keys(results).map((type) => (
                <div key={type} className="mb-5">
                  <h2 className="text-lg font-semibold mb-3 text-red-400 tracking-wide">
                    {type.toUpperCase()} Results
                  </h2>
                  <ul className="space-y-2">
                    {results[type].map((res: any, idx: number) => (
                      <li
                        key={idx}
                        className={`p-3 rounded-lg border ${
                          res.vulnerable
                            ? "border-red-500 bg-red-900/30"
                            : "border-zinc-700 bg-zinc-900/30"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:justify-between">
                          <span className="font-semibold">
                            Param: <span className="text-red-400">{res.param}</span>
                          </span>
                          <span
                            className={`${
                              res.vulnerable
                                ? "text-green-400"
                                : "text-gray-400"
                            } font-medium`}
                          >
                            {res.vulnerable ? "POSSIBLY VULNERABLE ⚠️" : "SAFE ✅"}
                          </span>
                        </div>
                        <p className="text-gray-400 text-sm mt-1">
                          Payload: {res.payload}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default VulnFuzzer;
