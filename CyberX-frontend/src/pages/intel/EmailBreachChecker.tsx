import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";

export default function EmailBreachChecker() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleCheck = async () => {
    setError(null);
    setInfo(null);
    setResult(null);

    if (!email) return setError("Enter an email address to check");

    setLoading(true);
    try {
      const resp = await fetch("http://localhost:8787/api/emailbreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || `Server returned ${resp.status}`);

      if (j.found) {
        setResult(j);
        setInfo("This email appears in breached datasets ⚠️");
      } else {
        setInfo("✅ No breach records found for this email.");
      }
    } catch (err: any) {
      setError(err.message || "Check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="📧 Email Breach Checker"
        message="Check if your email appears in public breach datasets."
        confirmText={loading ? "Checking..." : "Check Email"}
        cancelText="Reset"
        onConfirm={handleCheck}
        onCancel={() => {
          setEmail("");
          setError(null);
          setInfo(null);
          setResult(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <input
            type="email"
            placeholder="Enter email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 rounded bg-black/20 border border-red-500 text-white"
          />
          {error && <p className="text-red-400">{error}</p>}
          {info && <p className="text-green-300">{info}</p>}

          {result && (
            <div className="bg-black/10 rounded p-3 border border-red-500 mt-2 max-h-64 overflow-auto">
              <h4 className="text-lg font-semibold">Breach Details</h4>
              <pre className="whitespace-pre-wrap text-sm text-gray-200">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
}
