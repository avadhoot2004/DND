import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Gamepad2, Shield, Calendar, User, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ onOpenAuth }) {
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();

  const getRoleBadge = (role) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-gaming-amber/20 text-gaming-amber border-gaming-amber/40';
      case 'STAFF':
        return 'bg-gaming-cyan/20 text-gaming-cyan border-gaming-cyan/40';
      default:
        return 'bg-gaming-primary/20 text-gaming-accent border-gaming-primary/40';
    }
  };

  const isStaffOrAdmin =
    isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'STAFF');

  return (
    <header className="sticky top-0 z-40 glass-panel border-b border-gaming-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-gaming-primary to-gaming-accent flex items-center justify-center shadow-glow-primary group-hover:scale-105 transition-transform">
              <Gamepad2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="font-display font-extrabold text-xl tracking-tight text-white">
                DND <span className="text-gaming-cyan">GAMING</span> HUB
              </span>
              <span className="hidden sm:inline-block ml-2 px-2 py-0.5 text-xs rounded-full bg-gaming-border text-slate-300 font-medium">
                Lounge & Booking
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-6 text-sm font-medium text-slate-300">
            <Link
              to="/"
              className={`hover:text-white transition-colors flex items-center space-x-1.5 ${
                location.pathname === '/' ? 'text-white font-semibold' : ''
              }`}
            >
              <span>Stations</span>
            </Link>
            <Link
              to="/my-bookings"
              className={`hover:text-white transition-colors flex items-center space-x-1.5 ${
                location.pathname === '/my-bookings' ? 'text-white font-semibold' : ''
              }`}
            >
              <Calendar className="w-4 h-4 text-gaming-cyan" />
              <span>My Reservations</span>
            </Link>
            <Link
              to="/admin"
              className={`hover:text-white transition-colors flex items-center space-x-1.5 ${
                location.pathname === '/admin' ? 'text-white font-semibold' : ''
              }`}
            >
              <Shield className="w-4 h-4 text-gaming-accent" />
              <span>Owner Portal</span>
              {isStaffOrAdmin && (
                <span className="w-2 h-2 rounded-full bg-gaming-cyan animate-pulse" />
              )}
            </Link>
          </nav>

          {/* User Profile / Auth Actions */}
          <div className="flex items-center space-x-3">
            {isAuthenticated ? (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 pl-2 pr-3 py-1.5 rounded-xl bg-gaming-dark border border-gaming-border">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-gaming-primary to-gaming-accent flex items-center justify-center text-xs font-bold text-white">
                    {user.fullName?.charAt(0) || 'U'}
                  </div>
                  <div className="text-left">
                    <span className="text-xs font-bold text-white block leading-tight truncate max-w-[120px]">
                      {user.fullName}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold inline-block ${getRoleBadge(
                        user.role
                      )}`}
                    >
                      {user.role}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={logout}
                  title="Log Out"
                  className="p-2 rounded-xl text-slate-400 hover:text-gaming-rose hover:bg-gaming-dark border border-gaming-border transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => onOpenAuth('login')}
                  className="px-4 py-2 text-sm font-medium rounded-xl text-slate-200 bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border transition-all flex items-center space-x-1.5"
                >
                  <User className="w-4 h-4 text-slate-400" />
                  <span>Log In</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="px-4 py-2 text-sm font-semibold rounded-xl text-white bg-gradient-to-r from-gaming-primary to-gaming-accent hover:opacity-95 shadow-glow-primary transition-all"
                >
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
