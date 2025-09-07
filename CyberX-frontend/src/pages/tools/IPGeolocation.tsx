import React, { useState } from "react";
import axios from "axios";
import CyberpunkCard from "@/components/CyberpunkCard";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const IPGeolocation: React.FC = () => {
  const [ip, setIp] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async () => {
    if (!ip) {
      setError("Please enter a valid IP or domain.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await axios.post("http://localhost:8787/api/ip-geolocation", { ip });
      setResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to fetch geolocation data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-start pt-10 bg-transparent">
      <CyberpunkCard
        title="🌍 IP Geolocation Tool"
        message="Locate servers and attackers on a map using their IP or domain."
        confirmText={loading ? "Locating..." : "Locate"}
        cancelText="Reset"
        onConfirm={handleLookup}
        onCancel={() => {
          setIp("");
          setResult(null);
          setError(null);
        }}
        red="#ff2b45"
        deepRed="#d50f2f"
        panelAlpha={0.65}
        showBackground={false}
        width={750}
      >
        <div className="space-y-5 mt-4">
          <input
            type="text"
            placeholder="Enter IP address or domain (e.g. 8.8.8.8)"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="w-full p-3 rounded-lg bg-black/20 border border-red-500 text-white placeholder-gray-400 focus:outline-none focus:border-red-400 transition"
          />

          {error && (
            <p className="text-red-400 bg-red-900/30 border border-red-600 p-2 rounded-md text-sm">
              {error}
            </p>
          )}

          {result && result.success && (
            <div className="bg-black/10 rounded-lg border border-red-500 p-4 mt-4 shadow-[0_0_15px_rgba(255,43,69,0.4)]">
              <h2 className="text-xl font-semibold mb-3 text-red-400 tracking-wide">
                📍 Location Details
              </h2>
              <ul className="space-y-2">
                <li><b>IP:</b> {result.ip}</li>
                <li><b>Country:</b> {result.country}</li>
                <li><b>Region:</b> {result.region}</li>
                <li><b>City:</b> {result.city}</li>
                <li><b>ISP:</b> {result.isp}</li>
                <li><b>Org:</b> {result.org}</li>
                <li><b>Timezone:</b> {result.timezone}</li>
                <li><b>Latitude:</b> {result.lat}</li>
                <li><b>Longitude:</b> {result.lon}</li>
              </ul>

              {/* Map Display */}
              <div className="mt-4 rounded-lg border border-red-600 overflow-hidden">
                <MapContainer
                  center={[result.lat, result.lon]}
                  zoom={10}
                  style={{ height: "300px", width: "100%" }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap contributors"
                  />
                  <Marker position={[result.lat, result.lon]}>
                    <Popup>
                      {result.city}, {result.country} <br />
                      ISP: {result.isp}
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            </div>
          )}
        </div>
      </CyberpunkCard>
    </div>
  );
};

export default IPGeolocation;
