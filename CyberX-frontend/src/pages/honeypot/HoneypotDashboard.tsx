import React, { useState, useEffect } from "react";
import CyberpunkCard from "../../components/CyberpunkCard"; // Corrected import path
import { Globe, ShieldCheck, AlertTriangle, Users } from 'lucide-react';
import axios from 'axios';

// Mock data for initial display
const initialStats = [
  { name: 'Active Honeypots', value: 0, icon: Globe, color: 'text-cyan-400' },
  { name: 'Attacks Logged', value: 0, icon: ShieldCheck, color: 'text-green-400' },
  { name: 'High-Severity Alerts', value: 0, icon: AlertTriangle, color: 'text-red-400' },
  { name: 'Unique Attackers', value: 0, icon: Users, color: 'text-yellow-400' },
];

const HoneypotDashboard: React.FC = () => {
    const [stats, setStats] = useState(initialStats);
    const [recentEvents, setRecentEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const response = await axios.get('http://localhost:8787/api/honeypot/summary');
                const { summaryStats, recentAttacks } = response.data;

                const updatedStats = [
                    { name: 'Active Honeypots', value: summaryStats.activeHoneypots, icon: Globe, color: 'text-cyan-400' },
                    { name: 'Attacks Logged', value: summaryStats.attacksLogged, icon: ShieldCheck, color: 'text-green-400' },
                    { name: 'High-Severity Alerts', value: summaryStats.highSeverityAlerts, icon: AlertTriangle, color: 'text-red-400' },
                    { name: 'Unique Attackers', value: summaryStats.uniqueAttackers, icon: Users, color: 'text-yellow-400' },
                ];
                
                setStats(updatedStats);
                setRecentEvents(recentAttacks);
                setError(null);

            } catch (err) {
                setError('Failed to fetch honeypot data. Displaying placeholder data.');
                setRecentEvents([
                    { timestamp: new Date().toISOString(), type: 'SSH Login Attempt', attackerIp: '192.168.1.101', honeypot: 'Cowrie', severity: 'Medium' },
                    { timestamp: new Date().toISOString(), type: 'HTTP Scan', attackerIp: '10.0.0.54', honeypot: 'Dionaea', severity: 'Low' },
                ]);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 30000); 
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full max-w-7xl mx-auto animate-fade-in">
            <h1 className="text-4xl font-bold text-cyan-400 mb-4 text-center tracking-wider [text-shadow:0_0_10px_rgba(72,204,244,0.5)]">
                Honeypot Network Status
            </h1>
            <p className="text-center text-gray-400 mb-8">
                Real-time threat intelligence from our globally distributed honeypot sensors.
            </p>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {stats.map((stat) => (
                    <div key={stat.name} className="bg-black/40 border border-cyan-700/50 p-6 rounded-lg shadow-[0_0_20px_rgba(72,204,244,0.2)] backdrop-blur-sm transition-all hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(72,204,244,0.4)]">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-gray-400 text-sm">{stat.name}</p>
                                <p className={`text-4xl font-bold ${stat.color}`}>{loading ? '...' : stat.value}</p>
                            </div>
                            <stat.icon className={`w-12 h-12 ${stat.color}`} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Recent Events Log */}
            <CyberpunkCard
                title="Recent Threat Events"
                className="w-full"
                red="#00aaff"
                deepRed="#0077aa"
                panelAlpha={0.5}
            >
                <div className="h-[400px] overflow-y-auto pr-2">
                    {error && <p className="text-yellow-400 text-center py-4">{error}</p>}
                    {loading && <p className="text-center text-gray-300 py-4">Loading live telemetry...</p>}
                    
                    {!loading && recentEvents.length === 0 && !error && (
                         <div className="text-center text-gray-400 h-full flex items-center justify-center">
                            <p>No recent events detected. The network is quiet.</p>
                        </div>
                    )}

                    <div className="font-mono text-sm space-y-2">
                        {recentEvents.map((event: any, index: number) => (
                            <div key={index} className="bg-black/30 p-3 rounded-md border border-gray-700 hover:border-cyan-500 transition-colors">
                                <span className="text-gray-500 mr-3">{new Date(event.timestamp).toLocaleTimeString()}</span>
                                <span className={`mr-3 font-bold ${event.severity === 'High' ? 'text-red-500' : event.severity === 'Medium' ? 'text-yellow-500' : 'text-green-500'}`}>
                                    [{event.severity.toUpperCase()}]
                                </span>
                                <span className="text-cyan-300 mr-3">{event.honeypot}</span>
                                <span className="text-white">{event.type} from</span>
                                <span className="text-red-400 ml-2">{event.attackerIp}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </CyberpunkCard>
        </div>
    );
};

export default HoneypotDashboard;

