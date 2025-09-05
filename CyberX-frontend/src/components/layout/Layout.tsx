import React, { useState } from "react";
import WebGLBackground from "../WebGLBackground";
import {
  Menu,
  MenuItem,
  HoveredLink,
  ProductItem,
} from "../ui/navbar-menu";

const Layout: React.FC = () => {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="relative min-h-screen text-white">
      {/* WebGL Background */}
      <WebGLBackground />
      
    <div className="fixed top-10 inset-x-0 max-w-2xl mx-auto z-50">
      {/* Navbar */}
      <Menu setActive={setActive}>
        {/* Home */}
        <MenuItem setActive={setActive} active={active} item="Home">
          <div className="flex flex-col space-y-2">
            <HoveredLink href="/">Overview</HoveredLink>
            <HoveredLink href="/features">Features</HoveredLink>
            <HoveredLink href="/about">About</HoveredLink>
          </div>
        </MenuItem>

        {/* Tools */}
        <MenuItem setActive={setActive} active={active} item="Tools">
          <div className="grid grid-cols-1 gap-4">
            <ProductItem
              title="Port Scanner"
              description="Scan open ports on any target host."
              href="/tools/port-scanner"
              src="https://dummyimage.com/140x70/1e1e1e/ffffff.png&text=Port+Scanner"
            />
            <ProductItem
              title="Fuzzer"
              description="Send fuzzing payloads for vulnerability testing."
              href="/tools/fuzzer"
              src="https://dummyimage.com/140x70/222/fff.png&text=Fuzzer"
            />
            <ProductItem
              title="Bucket Enumeration"
              description="Find misconfigured cloud storage buckets."
              href="/tools/bucketing"
              src="https://dummyimage.com/140x70/333/fff.png&text=Buckets"
            />
          </div>
        </MenuItem>

        {/* Honeypot */}
        <MenuItem setActive={setActive} active={active} item="Honeypot">
          <div className="flex flex-col space-y-2">
            <HoveredLink href="/honeypot/ssh">SSH Honeypot</HoveredLink>
            <HoveredLink href="/honeypot/http">HTTP Honeypot</HoveredLink>
            <HoveredLink href="/honeypot/dashboard">Dashboard</HoveredLink>
          </div>
        </MenuItem>

        {/* AI Engine */}
        <MenuItem setActive={setActive} active={active} item="AI Engine">
          <div className="flex flex-col space-y-2">
            <HoveredLink href="/ai/learning">Adaptive Learning</HoveredLink>
            <HoveredLink href="/ai/reports">Threat Reports</HoveredLink>
            <HoveredLink href="/ai/visuals">Attack Visualizer</HoveredLink>
          </div>
        </MenuItem>

        {/* About */}
        <MenuItem setActive={setActive} active={active} item="About">
          <div className="flex flex-col space-y-2">
            <HoveredLink href="/about/project">Project Overview</HoveredLink>
            <HoveredLink href="/about/team">Meet the Team</HoveredLink>
            <HoveredLink href="/about/contact">Contact Us</HoveredLink>
          </div>
        </MenuItem>
      </Menu>
    </div>
      
    </div>
  );
};

export default Layout;
