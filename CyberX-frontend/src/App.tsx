import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Honeypots from './pages/Honeypots';
import AIEngine from './pages/AIEngine';
import OffensiveTools from './pages/OffensiveTools';
import DefensiveTools from './pages/DefensiveTools';
import Visualization from './pages/Visualization';
import Tools from './pages/Tools';
import Simulations from './pages/Simulations';
import Settings from './pages/Settings';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="honeypots/*" element={<Honeypots />} />
          <Route path="ai-engine/*" element={<AIEngine />} />
          <Route path="offensive-tools/*" element={<OffensiveTools />} />
          <Route path="defensive-tools/*" element={<DefensiveTools />} />
          <Route path="visualization/*" element={<Visualization />} />
          <Route path="tools/*" element={<Tools />} />
          <Route path="simulations/*" element={<Simulations />} />
          <Route path="deployment" element={<Settings />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
