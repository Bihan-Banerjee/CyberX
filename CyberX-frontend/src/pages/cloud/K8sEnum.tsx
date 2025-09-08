import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const K8sEnum: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEnumerate = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await axios.post("http://localhost:8787/api/k8s-enum");
      setResults(res.data.results);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to enumerate Kubernetes resources");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="☸️ Kubernetes Enumeration"
        message="Scan for misconfigured pods, services, roles, and secrets in the connected cluster."
        confirmText={loading ? "Enumerating..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleEnumerate}
        onCancel={() => {
          setResults(null);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {!loading && results && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)] max-h-[500px] overflow-y-auto">
              {Object.entries(results).map(([key, value]) => (
                <div key={key} className="mb-6">
                  <h3 className="text-lg font-semibold text-red-400 capitalize mb-2">
                    {key.replace(/([A-Z])/g, " $1")}
                  </h3>
                  <pre className="bg-zinc-900/30 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap">
                    {value || "No data"}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default K8sEnum;
