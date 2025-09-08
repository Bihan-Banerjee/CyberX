import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const ContainerScanner: React.FC = () => {
  const [image, setImage] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!image.trim()) {
      setError("Please enter a Docker image name (e.g. nginx:latest)");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const resp = await axios.post("http://localhost:8787/api/container-scan", { image });
      setResults(resp.data.vulnerabilities || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to scan image.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🐳 Container Vulnerability Scanner"
        message="Scan Docker images for known CVEs and security misconfigurations using Trivy."
        confirmText={loading ? "Scanning..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleScan}
        onCancel={() => {
          setImage("");
          setResults([]);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={850}
      >
        <div className="space-y-5 mt-4">
          {/* Input Field */}
          <input
            type="text"
            placeholder="Docker image (e.g. nginx:latest)"
            value={image}
            onChange={(e) => setImage(e.target.value)}
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
                Vulnerabilities ({results.length})
              </h2>
              <ul className="space-y-3 max-h-96 overflow-y-auto">
                {results.map((vuln, idx) => (
                  <li
                    key={idx}
                    className="bg-zinc-900/30 px-4 py-3 rounded-lg border border-zinc-700 hover:border-red-500 transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between">
                      <span className="font-semibold text-red-400">
                        {vuln.id} — {vuln.severity}
                      </span>
                      <span className="text-gray-300">
                        Package: {vuln.pkgName} ({vuln.installedVersion}) → Fixed: {vuln.fixedVersion}
                      </span>
                    </div>
                    <p className="text-gray-400 text-sm mt-1">{vuln.title}</p>
                    {vuln.references.length > 0 && (
                      <div className="mt-2 text-xs text-blue-400">
                        References:{" "}
                        {vuln.references.slice(0, 2).map((ref: string, i: number) => (
                          <a
                            key={i}
                            href={ref}
                            target="_blank"
                            rel="noreferrer"
                            className="underline ml-1"
                          >
                            [link {i + 1}]
                          </a>
                        ))}
                      </div>
                    )}
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

export default ContainerScanner;
