import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Home, Users, LogOut } from 'lucide-react';
import { getInitials } from '../lib/utils';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { icon: Home, label: 'My Groups', path: '/' },
    { icon: Users, label: 'Profile', path: '/profile' },
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">💸</div>
        <span className="sidebar-logo-text">SplitWise</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>
        {navItems.map((item) => (
          <button
            key={item.path}
            id={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <item.icon className="nav-icon" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="avatar">{user ? getInitials(user.name) : '?'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-sm font-semibold truncate">{user?.name}</div>
          <div className="text-xs text-muted truncate">{user?.email}</div>
        </div>
        <button
          id="logout-btn"
          className="btn btn-icon btn-ghost"
          onClick={handleLogout}
          title="Logout"
        >
          <LogOut size={16} color="var(--text-muted)" />
        </button>
      </div>
    </aside>
  );
}
