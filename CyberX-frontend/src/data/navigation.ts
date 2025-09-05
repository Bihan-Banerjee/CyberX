import type { NavItem } from '../types';

export const navigationItems: NavItem[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: '🎯',
    path: '/dashboard'
  },
  {
    id: 'honeypots',
    title: 'Honeypot Simulator',
    icon: '🍯',
    path: '/honeypots',
    children: [
      { id: 'ssh-honeypot', title: 'SSH Honeypot', icon: '🔑', path: '/honeypots/ssh' },
      { id: 'http-honeypot', title: 'HTTP Honeypot', icon: '🌐', path: '/honeypots/http' },
      { id: 'ftp-honeypot', title: 'FTP Honeypot', icon: '📁', path: '/honeypots/ftp' },
      { id: 'database-honeypot', title: 'Database Honeypot', icon: '🗄️', path: '/honeypots/database' }
    ]
  },
  {
    id: 'ai-engine',
    title: 'AI Engine',
    icon: '🧠',
    path: '/ai-engine',
    children: [
      { id: 'behavioral-analysis', title: 'Behavioral Analysis', icon: '📊', path: '/ai-engine/behavioral' },
      { id: 'anomaly-detection', title: 'Anomaly Detection', icon: '🚨', path: '/ai-engine/anomaly' },
      { id: 'threat-intelligence', title: 'Threat Intel', icon: '🔍', path: '/ai-engine/intel' }
    ]
  },
  {
    id: 'offensive-tools',
    title: 'Offensive Tools',
    icon: '⚔️',
    path: '/offensive-tools',
    children: [
      { id: 'reconnaissance', title: 'Reconnaissance', icon: '🔭', path: '/offensive-tools/recon' },
      { id: 'exploitation', title: 'Exploitation', icon: '💥', path: '/offensive-tools/exploit' },
      { id: 'malware-sim', title: 'Malware Simulator', icon: '🦠', path: '/offensive-tools/malware' }
    ]
  },
  {
    id: 'defensive-tools',
    title: 'Defensive Tools',
    icon: '🛡️',
    path: '/defensive-tools',
    children: [
      { id: 'ids', title: 'IDS', icon: '🚨', path: '/defensive-tools/ids' },
      { id: 'log-analysis', title: 'Log Analysis', icon: '📝', path: '/defensive-tools/logs' },
      { id: 'traffic-monitor', title: 'Traffic Monitor', icon: '📡', path: '/defensive-tools/traffic' }
    ]
  },
  {
    id: 'visualization',
    title: 'Visualization',
    icon: '📈',
    path: '/visualization',
    children: [
      { id: 'attack-map', title: 'Attack Map', icon: '🗺️', path: '/visualization/map' },
      { id: 'session-replay', title: 'Session Replay', icon: '▶️', path: '/visualization/replay' },
      { id: 'reports', title: 'Reports', icon: '📊', path: '/visualization/reports' }
    ]
  },
  {
    id: 'tools',
    title: 'Security Tools',
    icon: '🔧',
    path: '/tools',
    children: [
      { id: 'url-scanner', title: 'URL Scanner', icon: '🔗', path: '/tools/url-scanner' },
      { id: 'dns-resolver', title: 'DNS Resolver', icon: '🌐', path: '/tools/dns' },
      { id: 'jwt-inspector', title: 'JWT Inspector', icon: '🔑', path: '/tools/jwt' }
    ]
  },
  {
    id: 'simulations',
    title: 'Simulations',
    icon: '🎮',
    path: '/simulations',
    children: [
      { id: 'attack-lab', title: 'Attack Lab', icon: '🧪', path: '/simulations/attack-lab' },
      { id: 'defense-lab', title: 'Defense Lab', icon: '🔒', path: '/simulations/defense-lab' },
      { id: 'ctf-arena', title: 'CTF Arena', icon: '🏆', path: '/simulations/ctf' }
    ]
  },
  {
    id: 'deployment',
    title: 'Deployment',
    icon: '🚀',
    path: '/deployment'
  }
];
