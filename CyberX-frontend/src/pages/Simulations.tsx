import React from 'react';

const Simulations: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">Simulation Environments</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-red-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-red-400 mb-4">🧪 Attack Lab</h2>
          <p className="text-gray-300 text-sm mb-4">Practice offensive techniques in a safe environment</p>
          <div className="space-y-2 mb-4">
            <div className="text-sm text-gray-400">Available Scenarios: <span className="text-white">15</span></div>
            <div className="text-sm text-gray-400">Your Progress: <span className="text-yellow-400">60%</span></div>
          </div>
          <button className="w-full bg-red-500/20 text-red-400 border border-red-500/30 px-4 py-2 rounded hover:bg-red-500/30 transition-colors">
            Enter Attack Lab
          </button>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-green-400 mb-4">🔒 Defense Lab</h2>
          <p className="text-gray-300 text-sm mb-4">Deploy and configure defensive measures</p>
          <div className="space-y-2 mb-4">
            <div className="text-sm text-gray-400">Active Defenses: <span className="text-white">8</span></div>
            <div className="text-sm text-gray-400">Success Rate: <span className="text-green-400">92%</span></div>
          </div>
          <button className="w-full bg-green-500/20 text-green-400 border border-green-500/30 px-4 py-2 rounded hover:bg-green-500/30 transition-colors">
            Enter Defense Lab
          </button>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-purple-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">🏆 CTF Arena</h2>
          <p className="text-gray-300 text-sm mb-4">Capture the Flag challenges and competitions</p>
          <div className="space-y-2 mb-4">
            <div className="text-sm text-gray-400">Your Rank: <span className="text-white">#23</span></div>
            <div className="text-sm text-gray-400">Points: <span className="text-purple-400">1,847</span></div>
          </div>
          <button className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
            Join CTF
          </button>
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">🎮 Active Challenges</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <h3 className="font-semibold text-white mb-2">SQL Injection Master</h3>
            <p className="text-sm text-gray-400 mb-3">Complete all SQL injection challenges</p>
            <div className="flex justify-between items-center">
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">Beginner</span>
              <span className="text-xs text-gray-400">7/10 completed</span>
            </div>
          </div>
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <h3 className="font-semibold text-white mb-2">Network Defender</h3>
            <p className="text-sm text-gray-400 mb-3">Set up honeypots to catch 50 attackers</p>
            <div className="flex justify-between items-center">
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Intermediate</span>
              <span className="text-xs text-gray-400">23/50 caught</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Simulations;
