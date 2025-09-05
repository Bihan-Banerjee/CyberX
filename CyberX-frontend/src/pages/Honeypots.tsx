import React, { useState } from 'react';

const Honeypots: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');

  const honeypots = [
    { id: 1, name: 'SSH-Trap-01', type: 'SSH', status: 'active', attacks: 47, port: 22 },
    { id: 2, name: 'HTTP-Decoy-02', type: 'HTTP', status: 'active', attacks: 23, port: 80 },
    { id: 3, name: 'FTP-Bait-03', type: 'FTP', status: 'inactive', attacks: 12, port: 21 },
    { id: 4, name: 'DB-Honey-04', type: 'MySQL', status: 'active', attacks: 8, port: 3306 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-cyan-400">Honeypot Simulator</h1>
        <button className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded-lg hover:bg-cyan-500/30 transition-colors">
          + Deploy New Honeypot
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex space-x-8">
          {['overview', 'sessions', 'logs', 'configuration'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Honeypot Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {honeypots.map((honeypot) => (
          <div key={honeypot.id} className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{honeypot.name}</h3>
                <p className="text-sm text-gray-400">{honeypot.type} Honeypot - Port {honeypot.port}</p>
              </div>
              <span
                className={`px-2 py-1 text-xs font-semibold rounded ${
                  honeypot.status === 'active'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {honeypot.status}
              </span>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-400">Attacks Captured</span>
                <span className="text-sm font-semibold text-red-400">{honeypot.attacks}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-400">Last Activity</span>
                <span className="text-sm text-gray-300">2 min ago</span>
              </div>
            </div>

            <div className="mt-4 flex space-x-2">
              <button className="flex-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 px-3 py-2 rounded text-sm hover:bg-blue-500/30 transition-colors">
                View Sessions
              </button>
              <button className="flex-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 px-3 py-2 rounded text-sm hover:bg-purple-500/30 transition-colors">
                Configure
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Active Sessions */}
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">Live Attack Sessions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2">IP Address</th>
                <th className="text-left py-2">Honeypot</th>
                <th className="text-left py-2">Started</th>
                <th className="text-left py-2">Commands</th>
                <th className="text-left py-2">Risk</th>
                <th className="text-left py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-800">
                <td className="py-3 font-mono">192.168.1.100</td>
                <td className="py-3">SSH-Trap-01</td>
                <td className="py-3">5 min ago</td>
                <td className="py-3">12</td>
                <td className="py-3">
                  <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded text-xs">High</span>
                </td>
                <td className="py-3">
                  <button className="text-cyan-400 hover:text-cyan-300 text-xs mr-2">View</button>
                  <button className="text-red-400 hover:text-red-300 text-xs">Block</button>
                </td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 font-mono">10.0.0.50</td>
                <td className="py-3">HTTP-Decoy-02</td>
                <td className="py-3">12 min ago</td>
                <td className="py-3">7</td>
                <td className="py-3">
                  <span className="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-xs">Medium</span>
                </td>
                <td className="py-3">
                  <button className="text-cyan-400 hover:text-cyan-300 text-xs mr-2">View</button>
                  <button className="text-red-400 hover:text-red-300 text-xs">Block</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Honeypots;
