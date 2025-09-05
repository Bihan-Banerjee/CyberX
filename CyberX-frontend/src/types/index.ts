// Core types for the CyberX platform
export interface User {
  id: string;
  email: string;
  role: 'admin' | 'analyst' | 'guest';
  name: string;
  avatar?: string;
}

export interface HoneypotSession {
  id: string;
  ip: string;
  country: string;
  startTime: Date;
  endTime?: Date;
  commands: string[];
  serviceType: 'ssh' | 'http' | 'ftp' | 'database' | 'custom';
  status: 'active' | 'closed' | 'blocked';
}

export interface ThreatScore {
  ip: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastActivity: Date;
  attackTypes: string[];
}

export interface DashboardMetrics {
  activeAttacks: number;
  totalSessions: number;
  blockedIPs: number;
  systemHealth: {
    cpu: number;
    ram: number;
    network: number;
  };
  topAttackers: string[];
}

export interface NavItem {
  id: string;
  title: string;
  icon: string;
  path: string;
  children?: NavItem[];
}
