import React from 'react';

const OffensiveTools: React.FC = () => {
  const tools = [
    { name: 'Port Scanner', icon: '🔍', description: 'Nmap-like port scanning capabilities', status: 'ready' },
    { name: 'Subdomain Enum', icon: '🌐', description: 'Discover subdomains and services', status: 'ready' },
    { name: 'Directory Fuzzer', icon: '📁', description: 'Find hidden endpoints and files', status: 'ready' },
    { name: 'SQL Injection Tester', icon: '💉', description: 'Test for SQL injection vulnerabilities', status: 'beta' },
    { name: 'XSS Scanner', icon: '🔬', description: 'Cross-site scripting vulnerability scanner', status: 'beta' },
    { name: 'Credential Stuffing', icon: '🔑', description: 'Test credential reuse attacks', status: 'dev' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-red-400">Offensive Tools Suite</h1>
        <div className="text-sm bg-red-500/20 text-red-400 px-3 py-1 rounded border border-red-500/30">
          ⚠️ Use Responsibly - Ethical Hacking Only
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool, index) => (
          <div key={index} className="bg-gray-900/80 backdrop-blur-sm border border-red-500/20 p-6 rounded-lg hover:border-red-500/40 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-3xl">{tool.icon}</span>
              <span className={`px-2 py-1 text-xs font-semibold rounded ${
                tool.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                tool.status === 'beta' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-blue-500/20 text-blue-400'
              }`}>
                {tool.status}
              </span>
            </div>
            
            <h3 className="text-lg font-semibold text-white mb-2">{tool.name}</h3>
            <p className="text-sm text-gray-400 mb-4">{tool.description}</p>
            
            <button className="w-full bg-red-500/20 text-red-400 border border-red-500/30 px-4 py-2 rounded hover:bg-red-500/30 transition-colors">
              Launch Tool
            </button>
          </div>
        ))}
      </div>

      {/* Recent Scans */}
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">Recent Scans</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2">Target</th>
                <th className="text-left py-2">Tool</th>
                <th className="text-left py-2">Started</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Results</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-800">
                <td className="py-3 font-mono">192.168.1.0/24</td>
                <td className="py-3">Port Scanner</td>
                <td className="py-3">5 min ago</td>
                <td className="py-3">
                  <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs">Complete</span>
                </td>
                <td className="py-3">23 open ports</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OffensiveTools;
