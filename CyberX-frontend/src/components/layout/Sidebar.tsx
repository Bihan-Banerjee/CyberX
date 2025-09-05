import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { navigationItems } from '../../data/navigation';
import type { NavItem } from '../../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const location = useLocation();
  const [expandedItems, setExpandedItems] = useState<string[]>(['dashboard']);

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev => 
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const renderNavItem = (item: NavItem, level = 0) => {
    const isActive = location.pathname === item.path;
    const isExpanded = expandedItems.includes(item.id);
    const hasChildren = item.children && item.children.length > 0;

    return (
      <div key={item.id} className="mb-1">
        <div className="flex items-center">
          <Link
            to={item.path}
            className={`flex-1 flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${
              isActive
                ? 'bg-cyan-500/20 text-cyan-400 border-r-2 border-cyan-400'
                : 'text-gray-300 hover:bg-gray-800 hover:text-cyan-400'
            } ${level > 0 ? 'ml-6 text-sm' : ''}`}
            onClick={() => window.innerWidth < 768 && onClose()}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="font-medium">{item.title}</span>
          </Link>
          {hasChildren && (
            <button
              onClick={() => toggleExpanded(item.id)}
              className="p-2 text-gray-400 hover:text-cyan-400 transition-colors"
            >
              <svg
                className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
        
        {hasChildren && isExpanded && (
          <div className="mt-2 space-y-1">
            {item.children?.map(child => renderNavItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-16 left-0 h-[calc(100vh-4rem)] w-80 bg-gray-900/95 backdrop-blur-sm border-r border-cyan-500/20 z-50 transform transition-transform duration-300 overflow-y-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        <div className="p-4">
          <div className="space-y-2">
            {navigationItems.map(item => renderNavItem(item))}
          </div>

          {/* System Status */}
          <div className="mt-8 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-3">System Status</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Active Honeypots</span>
                <span className="text-xs text-green-400">12</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Live Attacks</span>
                <span className="text-xs text-red-400">7</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Blocked IPs</span>
                <span className="text-xs text-yellow-400">1,243</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-4 space-y-2">
            <button className="w-full bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-500/30 transition-colors">
              🚨 Emergency Stop
            </button>
            <button className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg px-4 py-2 text-sm font-medium hover:bg-cyan-500/30 transition-colors">
              🔄 Refresh Data
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
