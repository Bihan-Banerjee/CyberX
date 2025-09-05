import React from 'react';

const DefensiveTools: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-green-400">Defensive Tools Suite</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-green-400 mb-4">🛡️ Intrusion Detection</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Rules Active: <span className="text-white">1,247</span></div>
            <div className="text-sm text-gray-400">Alerts Today: <span className="text-red-400">23</span></div>
            <button className="w-full bg-green-500/20 text-green-400 border border-green-500/30 px-4 py-2 rounded hover:bg-green-500/30 transition-colors">
              View IDS Dashboard
            </button>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-blue-400 mb-4">📝 Log Analysis</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Logs Processed: <span className="text-white">2.3M</span></div>
            <div className="text-sm text-gray-400">Anomalies: <span className="text-yellow-400">47</span></div>
            <button className="w-full bg-blue-500/20 text-blue-400 border border-blue-500/30 px-4 py-2 rounded hover:bg-blue-500/30 transition-colors">
              Analyze Logs
            </button>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">📡 Traffic Monitor</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Live Connections: <span className="text-white">156</span></div>
            <div className="text-sm text-gray-400">Bandwidth: <span className="text-cyan-400">2.1 Gbps</span></div>
            <button className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
              Monitor Traffic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DefensiveTools;
