// src/components/layout/Layout.tsx
import React, { useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';
import WebGLBackground from '../WebGLBackground';
import { Menu, MenuItem, HoveredLink, ProductItem } from '../ui/navbar-menu';
import CyberpunkCursor from "@/components/CyberpunkCursor";
const Layout: React.FC<PropsWithChildren> = ({ children }) => {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="relative min-h-screen text-white isolate">
      {/* Animated background behind everything */}
      <WebGLBackground />

      {/* Optional subtle contrast over the animation */}
      <div className="fixed inset-0 -z-[1] pointer-events-none bg-gradient-to-b from-black/30 via-black/10 to-black/40" />

      {/* Navbar (fixed, centered, above background) */}
      <Menu setActive={setActive}>
        {/* Home */}
        <MenuItem setActive={setActive} active={active} item="Home">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/">Overview</Link>
            <Link className="hover:text-cyan-400" to="/visualizer">Attack Visualizer</Link>
            <Link className="hover:text-cyan-400" to="/reports">Threat Reports</Link>
          </div>
        </MenuItem>

        {/* Honeypot & Defense */}
        <MenuItem setActive={setActive} active={active} item="Honeypot">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/honeypot">Honeypot Dashboard</Link>
            <Link className="hover:text-cyan-400" to="/honeypot/ssh">SSH Honeypot</Link>
            <Link className="hover:text-cyan-400" to="/honeypot/http">HTTP Honeypot</Link>
            <Link className="hover:text-cyan-400" to="/honeypot/db">Database Honeypot</Link>
            <Link className="hover:text-cyan-400" to="/ids">IDS</Link>
            <Link className="hover:text-cyan-400" to="/siem">Log Monitoring & SIEM</Link>
          </div>
        </MenuItem>

        {/* Tools: Recon & Exploitation */}
        <MenuItem setActive={setActive} active={active} item="Tools">
          <div className="grid grid-cols-2 gap-3">
            <Link className="hover:text-cyan-400" to="/tools/port-scanner">Port Scanner</Link>
            <Link className="hover:text-cyan-400" to="/tools/service-detect">Service Detection</Link>
            <Link className="hover:text-cyan-400" to="/tools/os-fingerprint">OS Fingerprint</Link>
            <Link className="hover:text-cyan-400" to="/tools/subdomains">Subdomain Enum</Link>
            <Link className="hover:text-cyan-400" to="/tools/whois">WHOIS Lookup</Link>
            <Link className="hover:text-cyan-400" to="/tools/dns-recon">DNS Recon</Link>
            <Link className="hover:text-cyan-400" to="/tools/reverse-ip">Reverse IP</Link>
            <Link className="hover:text-cyan-400" to="/tools/ip-geo">IP Geolocation</Link>
            <Link className="hover:text-cyan-400" to="/tools/dir-fuzzer">Dir & File Fuzzer</Link>
            <Link className="hover:text-cyan-400" to="/tools/vuln-fuzzer">Vulnerability Fuzzer</Link>
            <Link className="hover:text-cyan-400" to="/tools/api-scanner">API Scanner</Link>
            <Link className="hover:text-cyan-400" to="/tools/broken-auth">Broken Auth Detector</Link>
          </div>
        </MenuItem>

        {/* Cloud & Containers */}
        <MenuItem setActive={setActive} active={active} item="Cloud">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/s3-finder">S3 Bucket Finder</Link>
            <Link className="hover:text-cyan-400" to="/tools/container-scan">Container CVE Scanner</Link>
            <Link className="hover:text-cyan-400" to="/tools/k8s-enum">Kubernetes Enum</Link>
          </div>
        </MenuItem>

        {/* Crypto & Hashing */}
        <MenuItem setActive={setActive} active={active} item="Crypto">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/hash-cracker">Hash Gen/Cracker</Link>
            <Link className="hover:text-cyan-400" to="/tools/ciphers">Cipher Tools</Link>
            <Link className="hover:text-cyan-400" to="/tools/rsa-aes">RSA/AES Encrypt/Decrypt</Link>
            <Link className="hover:text-cyan-400" to="/tools/jwt">JWT Decoder</Link>
          </div>
        </MenuItem>

        {/* Stego & Media */}
        <MenuItem setActive={setActive} active={active} item="Stego">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/stego-image">Image Steganography</Link>
            <Link className="hover:text-cyan-400" to="/tools/stego-audio">Audio Steganography</Link>
            <Link className="hover:text-cyan-400" to="/tools/stego-extract">Stego Extractor</Link>
            <Link className="hover:text-cyan-400" to="/tools/image-exif">Image EXIF Analyzer</Link>
          </div>
        </MenuItem>

        {/* OSINT & Intelligence */}
        <MenuItem setActive={setActive} active={active} item="OSINT">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/breach-check">Email Breach Checker</Link>
            <Link className="hover:text-cyan-400" to="/tools/google-dorks">Google Dorking</Link>
            <Link className="hover:text-cyan-400" to="/tools/shodan-censys">Shodan & Censys</Link>
            <Link className="hover:text-cyan-400" to="/tools/pastebin-leaks">Pastebin Leaks</Link>
            <Link className="hover:text-cyan-400" to="/intel">Threat Intelligence</Link>
          </div>
        </MenuItem>

        {/* AI & Simulations */}
        <MenuItem setActive={setActive} active={active} item="AI Engine">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/ai/engine">Adaptive Engine</Link>
            <Link className="hover:text-cyan-400" to="/ai/phishing">AI Phishing Detector</Link>
            <Link className="hover:text-cyan-400" to="/ai/malware">AI Malware Classifier</Link>
            <Link className="hover:text-cyan-400" to="/sim/rt-vs-bt">Red vs Blue Simulator</Link>
          </div>
        </MenuItem>

        {/* About */}
        <MenuItem setActive={setActive} active={active} item="About">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/about">Project</Link>
            <Link className="hover:text-cyan-400" to="/reports">Weekly Reports</Link>
          </div>
        </MenuItem>
      </Menu>

      {/* Content area (above overlay/background; below navbar) */}
      <main className="relative z-20 pt-20 px-4">
        <CyberpunkCursor />
        {children}
      </main>
    </div>
  );
};

export default Layout;
