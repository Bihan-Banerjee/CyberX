import React from 'react';

const Settings: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">System Settings & Deployment</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">🐳 Docker Configuration</h2>
          <div className="space-y-4">
            <div className="text-sm text-gray-400">Containers Running: <span className="text-green-400">12</span></div>
            <div className="text-sm text-gray-400">Total Memory: <span className="text-white">4.2 GB</span></div>
            <div className="text-sm text-gray-400">CPU Usage: <span className="text-yellow-400">34%</span></div>
            <button className="w-full bg-blue-500/20 text-blue-400 border border-blue-500/30 px-4 py-2 rounded hover:bg-blue-500/30 transition-colors">
              Manage Containers
            </button>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">☸️ Kubernetes</h2>
          <div className="space-y-4">
            <div className="text-sm text-gray-400">Pods Running: <span className="text-green-400">8</span></div>
            <div className="text-sm text-gray-400">Nodes: <span className="text-white">3</span></div>
            <div className="text-sm text-gray-400">Cluster Health: <span className="text-green-400">Healthy</span></div>
            <button className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
              K8s Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">⚙️ System Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">AI Engine Mode</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">
              <option>Aggressive</option>
              <option>Balanced</option>
              <option>Conservative</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Log Level</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">
              <option>DEBUG</option>
              <option>INFO</option>
              <option>WARN</option>
              <option>ERROR</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Auto-Block Threshold</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">
              <option>High (8+)</option>
              <option>Medium (6+)</option>
              <option>Low (4+)</option>
            </select>
          </div>
        </div>
        <button className="mt-4 bg-green-500/20 text-green-400 border border-green-500/30 px-6 py-2 rounded hover:bg-green-500/30 transition-colors">
          Save Configuration
        </button>
      </div>
    </div>
  );
};

export default Settings;
