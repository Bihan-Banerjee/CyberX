import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import WebGLBackground from '../WebGLBackground';
import type { User } from '../../types';

const Layout: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Mock user - replace with actual auth
  const mockUser: User = {
    id: '1',
    email: 'admin@cyberx.com',
    role: 'admin',
    name: 'CyberX Admin'
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="min-h-screen bg-black text-white relative">
      <WebGLBackground />
      
      <Navbar
        user={mockUser}
        onMenuToggle={toggleSidebar}
        isSidebarOpen={isSidebarOpen}
      />
      
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      <main
        className={`pt-16 transition-all duration-300 ${
          isSidebarOpen ? 'md:ml-80' : 'md:ml-0'
        }`}
      >
        <div className="relative z-10 p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
