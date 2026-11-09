import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Gamepad2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  User,
  Search,
  RefreshCw,
  ArrowLeft
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPaiseToRupees } from '../utils/formatters';

export default function MyBookingsPage({ onOpenAuth }) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [guestLookupRef, setGuestLookupRef] = useState('');
  const [cancellingId, setCancellingId] = useState(null);

  const fetchBookings = async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getMyBookings();
      setBookings(res.data || []);
    } catch (err) {
      setError(err.message || 'Failed to retrieve your reservations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchBookings();
    }
  }, [isAuthenticated]);

  const handleGuestLookup = (e) => {
    e.preventDefault();
    if (!guestLookupRef.trim()) return;
    navigate(`/booking/${guestLookupRef.trim().toUpperCase()}`);
  };

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Are you sure you want to cancel this booking? Slots will be released.')) return;
    try {
      setCancellingId(bookingId);
      await api.releaseBookingHold(bookingId, 'Cancelled by customer from history');
      fetchBookings();
    } catch (err) {
      alert(err.message || 'Failed to cancel booking');
    } finally {
      setCancellingId(null);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'CONFIRMED':
        return 'bg-gaming-emerald/15 text-gaming-emerald border-gaming-emerald/30';
      case 'ACTIVE':
        return 'bg-gaming-cyan/15 text-gaming-cyan border-gaming-cyan/30 animate-pulse';
      case 'PENDING_HOLD':
        return 'bg-gaming-amber/15 text-gaming-amber border-gaming-amber/30';
      case 'COMPLETED':
        return 'bg-slate-800 text-slate-300 border-slate-700';
      case 'CANCELLED':
      case 'NO_SHOW':
        return 'bg-gaming-rose/15 text-gaming-rose border-gaming-rose/30';
      default:
        return 'bg-gaming-dark text-slate-400 border-gaming-border';
    }
  };

  return (
    <div className="min-h-screen bg-gaming-dark flex flex-col py-10 px-4 sm:px-6">
      <div className="max-w-5xl w-full mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link
              to="/"
              className="text-xs font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5 mb-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Lounge</span>
            </Link>
            <h1 className="font-display text-3xl font-extrabold text-white tracking-tight">
              My Gaming Reservations
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              View confirmed battle station bookings, session passes, and history.
            </p>
          </div>

          {isAuthenticated && (
            <button
              type="button"
              onClick={fetchBookings}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-xs text-slate-300 hover:text-white flex items-center space-x-1.5 transition-colors self-start"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-gaming-cyan' : ''}`} />
              <span>Refresh History</span>
            </button>
          )}
        </div>

        {/* If NOT Authenticated: Guest Lookup & Login Card */}
        {!isAuthenticated && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Login Callout */}
            <div className="p-8 rounded-2xl glass-panel border border-gaming-border space-y-4">
              <div className="w-12 h-12 rounded-xl bg-gaming-primary/20 text-gaming-accent flex items-center justify-center">
                <User className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Log In to View Account History</h3>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                  Sign in with your verified gamer account to manage your active reservations and past sessions.
                </p>
              </div>
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => onOpenAuth && onOpenAuth('login')}
                  className="px-5 py-2.5 rounded-xl bg-gaming-primary hover:bg-gaming-primary/90 text-white text-xs font-semibold transition-all shadow-glow-primary"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth && onOpenAuth('register')}
                  className="px-5 py-2.5 rounded-xl bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-white text-xs font-semibold transition-all"
                >
                  Create Account
                </button>
              </div>
            </div>

            {/* Guest Reference Lookup */}
            <div className="p-8 rounded-2xl glass-panel border border-gaming-border space-y-4">
              <div className="w-12 h-12 rounded-xl bg-gaming-cyan/20 text-gaming-cyan flex items-center justify-center">
                <Search className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Guest Reservation Lookup</h3>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                  Booked as a guest? Enter your booking reference code to view or confirm your session pass.
                </p>
              </div>
              <form onSubmit={handleGuestLookup} className="flex space-x-2 pt-2">
                <input
                  type="text"
                  required
                  value={guestLookupRef}
                  onChange={(e) => setGuestLookupRef(e.target.value)}
                  placeholder="DND-20261026-A8F2"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-gaming-dark border border-gaming-border text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-gaming-cyan"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl bg-gaming-cyan/20 hover:bg-gaming-cyan/30 text-gaming-cyan border border-gaming-cyan/40 text-xs font-bold transition-all flex items-center space-x-1"
                >
                  <span>Find</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Authenticated Bookings List */}
        {isAuthenticated && (
          <div className="space-y-4">
            {loading ? (
              <div className="p-12 rounded-2xl bg-gaming-card border border-gaming-border flex items-center justify-center space-x-2 text-slate-400 text-sm">
                <Loader2 className="w-5 h-5 animate-spin text-gaming-cyan" />
                <span>Loading your booking history...</span>
              </div>
            ) : error ? (
              <div className="p-6 rounded-2xl bg-gaming-rose/10 border border-gaming-rose/30 text-gaming-rose text-sm text-center">
                {error}
              </div>
            ) : bookings.length === 0 ? (
              <div className="p-12 rounded-2xl glass-panel border border-gaming-border text-center space-y-3">
                <Gamepad2 className="w-10 h-10 text-slate-500 mx-auto" />
                <h3 className="text-lg font-bold text-white">No Reservations Found</h3>
                <p className="text-sm text-slate-400 max-w-sm mx-auto">
                  You don't have any bookings yet. Browse our live stations to claim your battle station!
                </p>
                <Link
                  to="/"
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gaming-primary text-white text-xs font-semibold shadow-glow-primary mt-2"
                >
                  <span>Explore Stations</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              bookings.map((b) => {
                const startTime = new Date(b.startTime).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                });
                const endTime = new Date(b.endTime).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                });
                const date = new Date(b.startTime).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
                });

                const canCancel =
                  b.bookingStatus === 'PENDING_HOLD' || b.bookingStatus === 'CONFIRMED';

                return (
                  <div
                    key={b._id}
                    className="p-5 sm:p-6 rounded-2xl bg-gaming-card border border-gaming-border hover:border-gaming-primary/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    {/* Left: Station & Timing */}
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-gaming-dark border border-gaming-border flex items-center justify-center text-gaming-cyan flex-shrink-0">
                        <Gamepad2 className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-gaming-dark text-slate-300 border border-gaming-border">
                            {b.stationId?.identifier || 'RIG'}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${getStatusBadge(b.bookingStatus)}`}>
                            {b.bookingStatus}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                            {b.paymentStatus}
                          </span>
                        </div>
                        <h4 className="text-white font-bold text-base">
                          {b.stationId?.name || 'Gaming Station'}
                        </h4>
                        <p className="text-xs text-slate-400 flex items-center space-x-2">
                          <span className="text-gaming-accent font-semibold">{date}</span>
                          <span>•</span>
                          <span>{startTime} – {endTime} ({b.durationMinutes} mins)</span>
                        </p>
                      </div>
                    </div>

                    {/* Right: Amount & Actions */}
                    <div className="flex items-center justify-between md:justify-end space-x-4 border-t md:border-t-0 pt-3 md:pt-0 border-gaming-border">
                      <div className="text-left md:text-right">
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Total Paid</span>
                        <span className="font-display text-lg font-extrabold text-white">
                          {formatPaiseToRupees(b.priceSnapshot?.totalAmountPaise || 0)}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {canCancel && (
                          <button
                            type="button"
                            disabled={cancellingId === b._id}
                            onClick={() => handleCancelBooking(b._id)}
                            className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-gaming-rose border border-gaming-border hover:bg-gaming-dark transition-colors"
                          >
                            {cancellingId === b._id ? 'Releasing...' : 'Cancel'}
                          </button>
                        )}

                        <Link
                          to={`/booking/${b._id}`}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gaming-dark hover:bg-gaming-cardHover border border-gaming-border hover:border-gaming-cyan/50 flex items-center space-x-1.5 transition-colors"
                        >
                          <span>Pass</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
