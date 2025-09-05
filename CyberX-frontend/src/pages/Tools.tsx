import React from 'react';

const Tools: React.FC = () => {
  const communityTools = [
    { name: 'URL Scanner', icon: '🔗', description: 'Scan URLs for security issues' },
    { name: 'DNS Resolver', icon: '🌐', description: 'Advanced DNS lookup and analysis' },
    { name: 'JWT Inspector', icon: '🔑', description: 'Decode and analyze JWT tokens' },
    { name: 'Hash Analyzer', icon: '#️⃣', description: 'Identify and crack hash formats' },
    { name: 'Base64 Decoder', icon: '🔓', description: 'Encode/decode Base64 strings' },
    { name: 'API Key Checker', icon: '🗝️', description: 'Validate API keys and tokens' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">Security Tools</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {communityTools.map((tool, index) => (
          <div key={index} className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg hover:border-cyan-500/40 transition-colors">
            <div className="text-center mb-4">
              <span className="text-4xl">{tool.icon}</span>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2 text-center">{tool.name}</h3>
            <p className="text-sm text-gray-400 mb-4 text-center">{tool.description}</p>
            <button className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded hover:bg-cyan-500/30 transition-colors">
              Open Tool
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Tools;
