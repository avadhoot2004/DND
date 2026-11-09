import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import AuthModal from './components/AuthModal';
import HomePage from './pages/HomePage';
import BookingConfirmationPage from './pages/BookingConfirmationPage';
import MyBookingsPage from './pages/MyBookingsPage';
import OwnerDashboardPage from './pages/OwnerDashboardPage';

export default function App() {
  const [authModalState, setAuthModalState] = useState({ isOpen: false, tab: 'login' });

  return (
    <div className="min-h-screen flex flex-col bg-gaming-dark">
      <Navbar onOpenAuth={(tab) => setAuthModalState({ isOpen: true, tab })} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/booking/:id" element={<BookingConfirmationPage />} />
          <Route
            path="/my-bookings"
            element={
              <MyBookingsPage
                onOpenAuth={(tab) => setAuthModalState({ isOpen: true, tab })}
              />
            }
          />
          <Route
            path="/admin"
            element={
              <OwnerDashboardPage
                onOpenAuth={(tab) => setAuthModalState({ isOpen: true, tab })}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalState.isOpen}
        onClose={() => setAuthModalState({ ...authModalState, isOpen: false })}
        initialTab={authModalState.tab}
      />

      {/* Footer */}
      <footer className="border-t border-gaming-border py-6 text-center text-xs text-slate-500">
        <p>DND Gaming Hub • Engineered for high-integrity bookings and low latency.</p>
      </footer>
    </div>
  );
}
