import React from 'react';
import type { DashboardMetrics } from '../types';

const Dashboard: React.FC = () => {
  // Mock data - replace with real API calls
  const metrics: DashboardMetrics = {
    activeAttacks: 12,
    totalSessions: 1847,
    blockedIPs: 2943,
    systemHealth: {
      cpu: 45,
      ram: 62,
      network: 28
    },
    topAttackers: ['192.168.1.100', '10.0.0.50', '172.16.0.25']
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-cyan-400">Central Command Center</h1>
        <div className="flex space-x-2">
          <button className="bg-green-500/20 text-green-400 border border-green-500/30 px-4 py-2 rounded-lg hover:bg-green-500/30 transition-colors">
            🟢 All Systems Online
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Active Attacks</p>
              <p className="text-2xl font-bold text-red-400">{metrics.activeAttacks}</p>
            </div>
            <span className="text-3xl">🚨</span>
          </div>
          <div className="mt-2 text-xs text-gray-500">+3 from last hour</div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Sessions</p>
              <p className="text-2xl font-bold text-cyan-400">{metrics.totalSessions.toLocaleString()}</p>
            </div>
            <span className="text-3xl">📊</span>
          </div>
          <div className="mt-2 text-xs text-gray-500">+127 today</div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Blocked IPs</p>
              <p className="text-2xl font-bold text-yellow-400">{metrics.blockedIPs.toLocaleString()}</p>
            </div>
            <span className="text-3xl">🛡️</span>
          </div>
          <div className="mt-2 text-xs text-gray-500">Auto-blocked</div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">AI Risk Score</p>
              <p className="text-2xl font-bold text-purple-400">8.7/10</p>
            </div>
            <span className="text-3xl">🧠</span>
          </div>
          <div className="mt-2 text-xs text-red-400">High Risk</div>
        </div>
      </div>

      {/* System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">System Health</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">CPU Usage</span>
                <span className="text-sm text-white">{metrics.systemHealth.cpu}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-cyan-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${metrics.systemHealth.cpu}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">RAM Usage</span>
                <span className="text-sm text-white">{metrics.systemHealth.ram}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${metrics.systemHealth.ram}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">Network Load</span>
                <span className="text-sm text-white">{metrics.systemHealth.network}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${metrics.systemHealth.network}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">Top Attacker IPs</h2>
          <div className="space-y-3">
            {metrics.topAttackers.map((ip, index) => (
              <div key={ip} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-mono text-gray-300">{ip}</span>
                  <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">High Risk</span>
                </div>
                <button className="text-xs text-cyan-400 hover:text-cyan-300">Block</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button className="bg-blue-500/20 text-blue-400 border border-blue-500/30 p-4 rounded-lg hover:bg-blue-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">🍯</div>
            <div className="text-sm font-medium">Deploy Honeypot</div>
          </button>
          <button className="bg-purple-500/20 text-purple-400 border border-purple-500/30 p-4 rounded-lg hover:bg-purple-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">🧠</div>
            <div className="text-sm font-medium">Run AI Analysis</div>
          </button>
          <button className="bg-green-500/20 text-green-400 border border-green-500/30 p-4 rounded-lg hover:bg-green-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📊</div>
            <div className="text-sm font-medium">Generate Report</div>
          </button>
          <button className="bg-red-500/20 text-red-400 border border-red-500/30 p-4 rounded-lg hover:bg-red-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">🚨</div>
            <div className="text-sm font-medium">Emergency Stop</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
