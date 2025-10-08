import React, { useEffect, useState } from "react";
import CyberpunkCard from "@/components/CyberpunkCard";
import axios from "axios";

const PacketAnalyzer: React.FC = () => {
  const [interfaces, setInterfaces] = useState<{ index: string; name: string }[]>([]);
  const [iface, setIface] = useState<string>("");
  const [filter, setFilter] = useState<string>("");
  const [duration, setDuration] = useState<number>(5);
  const [count, setCount] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [packets, setPackets] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [pcapFile, setPcapFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // load interfaces
    (async () => {
      try {
        const r = await axios.get("http://localhost:8787/api/packet-analyzer/interfaces");
        setInterfaces(r.data.interfaces || []);
      } catch (e) {
        // ignore or show message
        console.warn("Could not fetch interfaces (tshark might not be installed)");
      }
    })();
  }, []);

  const runLive = async () => {
    setError(null);
    setLoading(true);
    setPackets([]);
    setSummary(null);
    try {
      const payload: any = { iface, filter, duration: Number(duration) };
      if (count) payload.count = Number(count);
      const r = await axios.post("http://localhost:8787/api/packet-analyzer/live", payload, { timeout: (Number(duration) + 15) * 1000 });
      setSummary(r.data.summary || null);
      setPackets(r.data.packets || []);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Live capture failed");
    } finally {
      setLoading(false);
    }
  };

  const uploadPcap = async () => {
    if (!pcapFile) return setError("Choose a pcap file to upload");
    setError(null);
    setLoading(true);
    setPackets([]);
    setSummary(null);
    try {
      const fd = new FormData();
      fd.append("pcap", pcapFile);
      const r = await axios.post("http://localhost:8787/api/packet-analyzer/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setSummary(r.data.summary || null);
      setPackets(r.data.packets || []);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Upload/parse failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🛰️ Network Packet Analyzer"
        message="Upload a pcap file for analysis, or run a short live capture (requires tshark on backend and proper permissions)."
        confirmText={loading ? "Working..." : "Run Live Capture"}
        cancelText="Reset"
        onConfirm={runLive}
        onCancel={() => {
          setIface("");
          setFilter("");
          setDuration(5);
          setCount("");
          setPcapFile(null);
          setPackets([]);
          setSummary(null);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={900}
      >
        <div className="space-y-4 mt-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm mb-1">Interface</label>
              <select value={iface} onChange={(e) => setIface(e.target.value)} className="w-full p-2 rounded bg-black/20 border border-red-500">
                <option value="">-- Select interface (tshark) --</option>
                {interfaces.map((i) => <option key={i.index} value={i.name}>{i.index} — {i.name}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">If interfaces list is empty, tshark may not be installed on backend.</p>
            </div>

            <div>
              <label className="block text-sm mb-1">Capture filter (BPF)</label>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="tcp port 80 or host 1.2.3.4" className="w-full p-2 rounded bg-black/20 border border-zinc-700" />
            </div>

            <div>
              <label className="block text-sm mb-1">Duration (s) / Count</label>
              <div className="flex gap-2">
                <input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="p-2 rounded bg-black/20 border border-zinc-700 w-24" />
                <input type="number" min={1} placeholder="or packets" value={count as any} onChange={(e) => setCount(e.target.value ? Number(e.target.value) : "")} className="p-2 rounded bg-black/20 border border-zinc-700 w-28" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={runLive} disabled={loading} className="bg-red-500 px-4 py-2 rounded shadow">Run Live Capture</button>
            <span className="text-sm text-gray-400">OR</span>
            <input type="file" accept=".pcap,.pcapng" onChange={(e) => setPcapFile(e.target.files?.[0] || null)} />
            <button onClick={uploadPcap} disabled={loading || !pcapFile} className="bg-zinc-800 px-4 py-2 rounded">Upload & Analyze</button>
            <div className="ml-auto text-xs text-gray-400">Live capture requires tshark + privileges on backend.</div>
          </div>

          {error && <div className="text-red-400 p-2 bg-red-900/20 rounded">{error}</div>}

          {summary && (
            <div className="bg-black/10 rounded p-3 border border-red-500 mt-2">
              <div className="flex justify-between items-start">
                <h4 className="text-lg font-semibold text-red-400">Summary</h4>
                <div className="text-sm text-gray-300">Packets: {summary.totalPackets}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-2 text-sm">
                <div>
                  <div className="font-semibold text-gray-200">Top Protocols</div>
                  <ul className="mt-1">
                    {summary.topProtocols.map((p: any) => <li key={p[0]}>{p[0]} — {p[1]}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="font-semibold text-gray-200">Top Talkers</div>
                  <ul className="mt-1">
                    {summary.topTalkers.map((t: any) => <li key={t[0]}>{t[0]} — {t[1]}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="font-semibold text-gray-200">Top Dests</div>
                  <ul className="mt-1">
                    {summary.topDests.map((d: any) => <li key={d[0]}>{d[0]} — {d[1]}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {packets.length > 0 && (
            <div className="bg-black/10 rounded p-3 border border-red-500 mt-2 max-h-[48vh] overflow-auto">
              <h4 className="text-lg font-semibold text-red-400 mb-2">Packets (first {packets.length})</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-300">
                    <th className="pr-4">Time</th>
                    <th className="pr-4">Src → Dst</th>
                    <th className="pr-4">Proto</th>
                    <th className="pr-4">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {packets.map((p, i) => {
                    const layers = p._source?.layers || p._source || {};
                    const time = layers.frame?.frame_time || layers["frame.time"] || "-";
                    const src = layers.ip?.ip_src || layers["ip.src"] || (layers["eth.src"] || "").split(",")[0] || "-";
                    const dst = layers.ip?.ip_dst || layers["ip.dst"] || (layers["eth.dst"] || "").split(",")[0] || "-";
                    const proto = (layers.frame?.frame_protocols || layers.frame_protocols || "unknown").split(":").slice(-1)[0];
                    const info = JSON.stringify(layers).slice(0, 120);
                    return (
                      <tr key={i} className="border-t border-zinc-800">
                        <td className="py-2 text-xs">{time}</td>
                        <td className="py-2 text-xs">{src} → {dst}</td>
                        <td className="py-2 text-xs">{proto}</td>
                        <td className="py-2 text-xs break-words">{info}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default PacketAnalyzer;
