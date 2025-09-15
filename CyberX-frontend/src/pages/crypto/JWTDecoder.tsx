// CyberX-frontend/src/pages/tools/JWTDecoder.tsx
import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";

const JWTDecoder: React.FC = () => {
  const [token, setToken] = useState("");
  const [decoded, setDecoded] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDecode = async () => {
    if (!token.trim()) {
      setError("Please enter a JWT token.");
      return;
    }

    setError(null);
    setDecoded(null);
    setLoading(true);

    try {
      const resp = await axios.post("http://localhost:8787/api/jwt-decode", { token });
      setDecoded(resp.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to decode JWT");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🔑 JWT Decoder"
        message="Inspect JSON Web Tokens. Decodes header & payload (does not validate signature)."
        confirmText={loading ? "Decoding..." : "Decode JWT"}
        cancelText="Reset"
        onConfirm={handleDecode}
        onCancel={() => {
          setToken("");
          setDecoded(null);
          setError(null);
        }}
        red="#ffb347"
        deepRed="#ff7f50"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <textarea
            placeholder="Paste JWT here"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            className="w-full p-3 rounded-lg bg-black/20 border border-yellow-500 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-400 transition"
          />

          {error && <p className="text-red-400">{error}</p>}

          {decoded && (
            <div className="bg-black/20 border border-yellow-500 rounded-lg p-3 max-h-96 overflow-y-auto">
              <h3 className="text-yellow-400 font-bold">Header</h3>
              <pre className="text-gray-300 text-sm whitespace-pre-wrap break-all">
                {JSON.stringify(decoded.header, null, 2)}
              </pre>
              <h3 className="text-yellow-400 font-bold mt-3">Payload</h3>
              <pre className="text-gray-300 text-sm whitespace-pre-wrap break-all">
                {JSON.stringify(decoded.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default JWTDecoder;
