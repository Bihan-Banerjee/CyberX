import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import Layout from '@/components/layout/Layout';  

const pages = import.meta.glob('../pages/**/[A-Za-z0-9][A-Za-z0-9-_]*/index.{tsx,jsx}', { import: 'default' });
const singlePages = import.meta.glob('../pages/**/[A-Za-z0-9][A-Za-z0-9-_]*.{tsx,jsx}', { import: 'default' });

const Placeholder: React.FC<{ title: string }> = ({ title }) => (
  <div className="p-8 text-center">
    <h1 className="text-2xl font-bold mb-2">{title}</h1>
    <p className="text-gray-400">Scaffold this page at src/pages/{title}.tsx or the configured path.</p>
  </div>
);

export type RouteCategory =
  | 'dashboard'
  | 'honeypot'
  | 'ids'
  | 'siem'
  | 'tools'
  | 'ai'
  | 'reports'
  | 'viz'
  | 'sim'
  | 'cloud'
  | 'crypto'
  | 'stego'
  | 'intel'
  | 'misc';

export interface RouteMeta {
  id: string;
  title: string;
  icon?: string;
  category: RouteCategory;
  description?: string;
  tags?: string[];
  hidden?: boolean;
}

export interface AppRouteDef {
  path: string;            
  page?: string;           
  meta: RouteMeta;
  children?: AppRouteDef[];
  index?: boolean;
}

function lazyFrom(page?: string, title?: string): Pick<RouteObject, 'lazy' | 'Component'> {
  // 🔹 If no page is defined → don't expect an Index.tsx
  if (!page) return { Component: () => <Outlet /> };

  const normalizedCandidates = [
    `../pages/${page}/index.tsx`,
    `../pages/${page}/index.jsx`,
    `../pages/${page}.tsx`,
    `../pages/${page}.jsx`,
  ];

  const match =
    normalizedCandidates.find((p) => p in pages) ??
    normalizedCandidates.find((p) => p in singlePages);

  if (match && (pages as Record<string, any>)[match]) {
    return {
      lazy: async () => {
        const Comp = await (pages as Record<string, any>)[match]();
        return { Component: Comp as React.ComponentType };
      },
    };
  }

  if (match && (singlePages as Record<string, any>)[match]) {
    return {
      lazy: async () => {
        const Comp = await (singlePages as Record<string, any>)[match]();
        return { Component: Comp as React.ComponentType };
      },
    };
  }

  return { Component: () => <Placeholder title={page} /> };
}


// Global route registry (add/rename here only)
export const ROUTES: AppRouteDef[] = [
  {
    path: '/',
    page: 'Home',
    index: true,
    meta: { id: 'home', title: 'Home', icon: '🏠', category: 'dashboard', tags: ['overview'] },
  },

  // Honeypot & Defense
  {
    path: 'honeypot',
    page: 'honeypot/Dashboard',
    meta: { id: 'honeypot', title: 'Honeypot Simulator', icon: '🍯', category: 'honeypot' },
    children: [
      { path: 'ssh', page: 'honeypot/SSH', meta: { id: 'hp-ssh', title: 'SSH Honeypot', category: 'honeypot' } },
      { path: 'http', page: 'honeypot/HTTP', meta: { id: 'hp-http', title: 'HTTP Honeypot', category: 'honeypot' } },
      { path: 'db', page: 'honeypot/Database', meta: { id: 'hp-db', title: 'Database Honeypot', category: 'honeypot' } },
      { path: 'custom', page: 'honeypot/Custom', meta: { id: 'hp-custom', title: 'Custom Socket', category: 'honeypot' } },
    ],
  },
  { path: 'ids', page: 'defense/IDS', meta: { id: 'ids', title: 'Intrusion Detection', icon: '🛡️', category: 'ids' } },
  { path: 'siem', page: 'defense/SIEM', meta: { id: 'siem', title: 'Log Monitoring & SIEM', icon: '🗄️', category: 'siem' } },

  // AI & Intelligence
  { path: 'ai/engine', page: 'ai/Engine', meta: { id: 'ai-engine', title: 'Adaptive Threat Engine', icon: '🧠', category: 'ai' } },
  { path: 'ai/phishing', page: 'ai/PhishingDetector', meta: { id: 'ai-phish', title: 'AI Phishing Detector', category: 'ai' } },
  { path: 'ai/malware', page: 'ai/MalwareClassifier', meta: { id: 'ai-malware', title: 'AI Malware Classifier', category: 'ai' } },
  { path: 'intel', page: 'intel/ThreatIntel', meta: { id: 'intel', title: 'Threat Intelligence', icon: '🔍', category: 'intel' } },

  // Visualization & Reports
  { path: 'visualizer', page: 'viz/AttackVisualizer', meta: { id: 'visualizer', title: 'Attack Visualizer', icon: '📈', category: 'viz' } },
  { path: 'reports', page: 'reports/ThreatReports', meta: { id: 'reports', title: 'Reports', icon: '📊', category: 'reports' } },

  // Simulations
  { path: 'sim/rt-vs-bt', page: 'sim/RedVsBlue', meta: { id: 'sim-rtbt', title: 'Red vs Blue Simulator', icon: '🎮', category: 'sim' } },

  // Core Tools (Offensive/Recon/Cloud/Crypto/Stego/Misc)
  {
    path: 'tools',
    meta: { id: 'tools', title: 'Tools', icon: '🔧', category: 'tools' },
    children: [
      // Recon
      { path: 'port-scanner', page: 'tools/PortScanner', meta: { id: 'port-scan', title: 'Port Scanner', category: 'tools', tags: ['tcp','udp'] } },
      { path: 'service-detect', page: 'tools/ServiceDetection', meta: { id: 'svc-detect', title: 'Service & Version Detection', category: 'tools' } },
      { path: 'os-fingerprint', page: 'tools/OSFingerprint', meta: { id: 'os-fp', title: 'OS Fingerprinting', category: 'tools' } },
      { path: 'subdomains', page: 'tools/SubdomainEnum', meta: { id: 'sub-enum', title: 'Subdomain Enumeration', category: 'tools' } },
      { path: 'whois', page: 'tools/Whois', meta: { id: 'whois', title: 'WHOIS Lookup', category: 'tools' } },
      { path: 'dns-recon', page: 'tools/DNSRecon', meta: { id: 'dns-recon', title: 'DNS Recon', category: 'tools' } },
      { path: 'reverse-ip', page: 'tools/ReverseIP', meta: { id: 'rev-ip', title: 'Reverse IP Lookup', category: 'tools' } },
      { path: 'ip-geo', page: 'tools/IPGeolocation', meta: { id: 'ip-geo', title: 'IP Geolocation', category: 'tools' } },
      { path: 'dir-fuzzer', page: 'tools/DirFuzzer', meta: { id: 'dir-fuzz', title: 'Directory & File Fuzzer', category: 'tools' } },
      { path: 'vuln-fuzzer', page: 'tools/VulnFuzzer', meta: { id: 'vuln-fuzz', title: 'Vulnerability Fuzzer', category: 'tools' } },
      { path: 'api-scanner', page: 'tools/APIScanner', meta: { id: 'api-scan', title: 'API Endpoint Scanner', category: 'tools' } },
      { path: 'broken-auth', page: 'tools/BrokenAuth', meta: { id: 'broken-auth', title: 'Broken Auth Detector', category: 'tools' } },

      // Cloud & Containers
      { path: 's3-finder', page: 'cloud/S3Finder', meta: { id: 's3', title: 'S3 Bucket Finder', category: 'cloud' } },
      { path: 'container-scan', page: 'cloud/ContainerScanner', meta: { id: 'containers', title: 'Container CVE Scanner', category: 'cloud' } },
      { path: 'k8s-enum', page: 'cloud/K8sEnum', meta: { id: 'k8s', title: 'Kubernetes Enum', category: 'cloud' } },

      // Crypto/Hashing
      { path: 'hash-cracker', page: 'crypto/HashCracker', meta: { id: 'hash', title: 'Hash Generator/Cracker', category: 'crypto' } },
      { path: 'ciphers', page: 'crypto/CipherTools', meta: { id: 'ciphers', title: 'Cipher Encoder/Decoder', category: 'crypto' } },
      { path: 'rsa-aes', page: 'crypto/RsaAes', meta: { id: 'rsa-aes', title: 'RSA/AES Encrypt/Decrypt', category: 'crypto' } },
      { path: 'jwt', page: 'crypto/JWTDecoder', meta: { id: 'jwt', title: 'JWT Decoder', category: 'crypto' } },

      // Steganography & Media
      { path: 'stego-image', page: 'stego/ImageStego', meta: { id: 'stego-img', title: 'Image Steganography', category: 'stego' } },
      { path: 'stego-audio', page: 'stego/AudioStego', meta: { id: 'stego-audio', title: 'Audio Steganography', category: 'stego' } },
      { path: 'stego-extract', page: 'stego/StegoExtract', meta: { id: 'stego-extract', title: 'Stego Extractor', category: 'stego' } },
      { path: 'image-exif', page: 'stego/ImageMetadata', meta: { id: 'exif', title: 'Image Metadata Analyzer', category: 'stego' } },

      // Intelligence & OSINT
      { path: 'breach-check', page: 'intel/BreachChecker', meta: { id: 'breach', title: 'Email Breach Checker', category: 'intel' } },
      { path: 'google-dorks', page: 'intel/GoogleDorker', meta: { id: 'dorks', title: 'Google Dorking', category: 'intel' } },
      { path: 'shodan-censys', page: 'intel/ShodanCensys', meta: { id: 'shodan', title: 'Shodan & Censys', category: 'intel' } },
      { path: 'pastebin-leaks', page: 'intel/PastebinLeaks', meta: { id: 'pastebin', title: 'Pastebin Leak Finder', category: 'intel' } },

      // Low-level/Analysis
      { path: 'mem-dump', page: 'misc/MemoryDump', meta: { id: 'memdump', title: 'Memory Dump Analyzer', category: 'misc' } },
      { path: 'packet-analyzer', page: 'misc/PacketAnalyzer', meta: { id: 'pcap', title: 'Network Packet Analyzer', category: 'misc' } },
    ],
  },

  // Fallbacks
  { path: 'about', page: 'About', meta: { id: 'about', title: 'About', category: 'misc' } },
  { path: '*', page: 'NotFound', meta: { id: '404', title: 'Not Found', category: 'misc', hidden: true } },
];

function mapDefs(defs: AppRouteDef[]): RouteObject[] {
  return defs.map((def) => {
    const route: RouteObject = {
      path: def.path,
      index: def.index,
      ...lazyFrom(def.page, def.meta.title),
    };
    if (def.children?.length) {
      route.children = mapDefs(def.children);
    }
    return route;
  });
}

const rootRoute: RouteObject = {
  path: '/',
  element: <Layout><Outlet /></Layout>, 
  children: mapDefs(ROUTES),            
};

export const router = createBrowserRouter([rootRoute]);

export const flatRoutes = (defs: AppRouteDef[] = ROUTES): RouteMeta[] => {
  const out: RouteMeta[] = [];
  const walk = (arr: AppRouteDef[]) => {
    arr.forEach((r) => {
      out.push(r.meta);
      if (r.children) walk(r.children);
    });
  };
  walk(defs);
  return out;
};

export const findById = (id: string, defs: AppRouteDef[] = ROUTES): AppRouteDef | undefined => {
  for (const r of defs) {
    if (r.meta.id === id) return r;
    if (r.children) {
      const f = findById(id, r.children);
      if (f) return f;
    }
  }
  return undefined;
};
