import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const SubdomainEnum: React.FC = () => {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [subdomains, setSubdomains] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!domain) {
      setError("Please enter a valid domain.");
      return;
    }

    setLoading(true);
    setError(null);
    setSubdomains([]);

    try {
      const response = await axios.post("http://localhost:8787/api/subdomains", {
        domain,
        bruteForce: true,
        limit: 50,
      });
      setSubdomains(response.data.subdomains || []);
    } catch (err: any) {
      setError("Failed to enumerate subdomains. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🌐 Subdomain Enumeration"
        message="Discover hidden subdomains using passive APIs and brute force."
        confirmText={loading ? "Scanning..." : "Start Scan"}
        cancelText="Reset"
        onConfirm={handleScan}
        onCancel={() => {
          setDomain("");
          setSubdomains([]);
          setError(null);
        }}
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
            placeholder="Enter target domain (e.g. example.com)"
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
          {!loading && subdomains.length > 0 && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)]">
              <h2 className="text-xl font-semibold mb-3 text-red-400 tracking-wide">
                Found Subdomains ({subdomains.length})
              </h2>
              <ul className="space-y-3 max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-red-600">
                {subdomains.map((sub, idx) => (
                  <li
                    key={idx}
                    className="bg-zinc-900/30 px-4 py-3 rounded-lg border border-zinc-700 hover:border-red-500 transition"
                  >
                    <a
                      href={`http://${sub}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-red-400 hover:underline"
                    >
                      {sub}
                    </a>
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

export default SubdomainEnum;
