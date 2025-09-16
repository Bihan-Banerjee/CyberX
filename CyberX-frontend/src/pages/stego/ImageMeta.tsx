import React, { useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";
import axios from "axios";

export default function ImageMeta() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<any | null>(null);

  const handleAnalyze = async () => {
    if (!file) return setError("Choose an image first");
    setLoading(true);
    setError(null);
    setMetadata(null);

    try {
      const fd = new FormData();
      fd.append("image", file);

      const resp = await axios.post("http://localhost:8787/api/image-meta", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      if (resp.data && resp.data.success) {
        setMetadata(resp.data.metadata);
      } else {
        setError(resp.data?.error || "No metadata found");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to analyze");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🖼️ Image Metadata Analyzer"
        message="Upload a PNG, JPEG, or TIFF to extract EXIF/IPTC/XMP metadata (camera, GPS, timestamps, etc.)."
        confirmText={loading ? "Working..." : "Analyze"}
        cancelText="Reset"
        onConfirm={handleAnalyze}
        onCancel={() => { setFile(null); setError(null); setMetadata(null); }}
        red="#ff7a4d"
        deepRed="#d1442a"
        panelAlpha={0.65}
        showBackground={false}
        width={820}
      >
        <div className="space-y-4 mt-4">
          <input type="file" accept=".jpg,.jpeg,.png,.tif,.tiff,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {error && <p className="text-red-400">{error}</p>}
          {metadata && (
            <div className="bg-black/10 rounded p-3 border border-red-500 max-h-[400px] overflow-y-auto text-sm">
              <pre className="whitespace-pre-wrap text-gray-200">
                {JSON.stringify(metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
}
