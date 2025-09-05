import React from 'react';

const Visualization: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">Visualization & Reporting</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">🗺️ Live Attack Map</h2>
          <div className="bg-gray-800/50 rounded-lg p-4 h-64 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-2">🌍</div>
              <p>Interactive world map showing real-time attacks</p>
              <button className="mt-4 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded hover:bg-cyan-500/30 transition-colors">
                Launch Map
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">▶️ Session Replay</h2>
          <div className="bg-gray-800/50 rounded-lg p-4 h-64 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-2">🎬</div>
              <p>Replay attacker sessions step by step</p>
              <button className="mt-4 bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
                View Sessions
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-green-400 mb-4">📊 Threat Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="bg-green-500/20 text-green-400 border border-green-500/30 p-4 rounded-lg hover:bg-green-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📄</div>
            <div>Daily Report</div>
          </button>
          <button className="bg-blue-500/20 text-blue-400 border border-blue-500/30 p-4 rounded-lg hover:bg-blue-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📈</div>
            <div>Weekly Summary</div>
          </button>
          <button className="bg-purple-500/20 text-purple-400 border border-purple-500/30 p-4 rounded-lg hover:bg-purple-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📋</div>
            <div>Custom Report</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Visualization;
