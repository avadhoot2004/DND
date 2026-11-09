import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  Server,
  Calendar,
  DollarSign,
  Play,
  CheckCircle2,
  UserX,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  Wrench,
  Clock,
  User,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPaiseToRupees } from '../utils/formatters';

export default function OwnerDashboardPage({ onOpenAuth }) {
  const { user, isAuthenticated } = useAuth();

  const [activeTab, setActiveTab] = useState('bookings'); // 'bookings' | 'stations'
  const [stations, setStations] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter state for bookings
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [stationModalState, setStationModalState] = useState({ isOpen: false, station: null });
  const [walkInModalOpen, setWalkInModalOpen] = useState(false);
  const [extendModalState, setExtendModalState] = useState({ isOpen: false, booking: null });
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);

  // Form states
  const [stationForm, setStationForm] = useState({
    identifier: '',
    name: '',
    type: 'PC',
    hourlyRatePaise: 12000,
    description: '',
    status: 'AVAILABLE'
  });

  const [walkInForm, setWalkInForm] = useState({
    stationId: '',
    fullName: '',
    durationMinutes: 60,
    notes: 'Walk-in cash customer'
  });

  const [extendMinutes, setExtendMinutes] = useState(30);
  const [maintenanceForm, setMaintenanceForm] = useState({
    stationId: '',
    startTime: '',
    endTime: '',
    reason: 'Routine hardware cleaning & thermal re-paste'
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const isStaffOrAdmin =
    isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'STAFF');

  const fetchData = async () => {
    if (!isStaffOrAdmin) return;
    try {
      setLoading(true);
      setError(null);
      const [stRes, bkRes] = await Promise.all([
        api.getStations({ includeDeactivated: true }),
        api.getAllBookings()
      ]);
      setStations(stRes.data || []);
      setBookings(bkRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load owner dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isStaffOrAdmin) {
      fetchData();
    }
  }, [isStaffOrAdmin]);

  // Session Control Handlers
  const handleStartSession = async (id) => {
    try {
      setActionLoading(true);
      await api.startSession(id);
      setNotice({ type: 'success', text: 'Session checked in and started (ACTIVE)' });
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to start session');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteSession = async (id) => {
    if (!window.confirm('Complete this session and checkout the customer?')) return;
    try {
      setActionLoading(true);
      await api.completeSession(id);
      setNotice({ type: 'success', text: 'Session checked out and completed' });
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to complete session');
    } finally {
      setActionLoading(false);
    }
  };

  const handleNoShow = async (id) => {
    if (!window.confirm('Mark customer as No-Show and release reserved slots?')) return;
    try {
      setActionLoading(true);
      await api.markNoShow(id);
      setNotice({ type: 'info', text: 'Reservation marked as No-Show. Slots freed up.' });
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to mark No-Show');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExtendSubmit = async (e) => {
    e.preventDefault();
    if (!extendModalState.booking) return;
    try {
      setActionLoading(true);
      await api.extendSession(extendModalState.booking._id, extendMinutes);
      setNotice({
        type: 'success',
        text: `Successfully extended session by ${extendMinutes} minutes!`
      });
      setExtendModalState({ isOpen: false, booking: null });
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to extend session');
    } finally {
      setActionLoading(false);
    }
  };

  // Station Form Submission (Add / Edit)
  const handleSaveStation = async (e) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      if (stationModalState.station) {
        // Update existing
        await api.updateStation(stationModalState.station._id, {
          name: stationForm.name,
          hourlyRatePaise: Number(stationForm.hourlyRatePaise),
          description: stationForm.description,
          status: stationForm.status
        });
        setNotice({ type: 'success', text: 'Station updated successfully' });
      } else {
        // Create new
        await api.createStation({
          ...stationForm,
          hourlyRatePaise: Number(stationForm.hourlyRatePaise)
        });
        setNotice({ type: 'success', text: 'New station created successfully' });
      }
      setStationModalState({ isOpen: false, station: null });
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to save station');
    } finally {
      setActionLoading(false);
    }
  };

  // Walk-In Fast Booking Form Submission
  const handleWalkInSubmit = async (e) => {
    e.preventDefault();
    if (!walkInForm.stationId) {
      alert('Please choose an available station');
      return;
    }

    try {
      setActionLoading(true);
      // Align start time to current time or nearest next 15-minute slot
      const now = new Date();
      const min = now.getMinutes();
      const rem = min % 15;
      const slotStart = new Date(now);
      slotStart.setMinutes(min - rem, 0, 0); // start of current interval
      const slotEnd = new Date(slotStart.getTime() + walkInForm.durationMinutes * 60 * 1000);

      // 1. Hold
      const holdRes = await api.createBookingHold({
        stationId: walkInForm.stationId,
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        isGuest: true,
        guestInfo: {
          fullName: walkInForm.fullName || 'Walk-In Customer',
          email: `walkin-${Date.now()}@dndlounge.local`
        },
        paymentType: 'WALK_IN_CASH',
        notes: walkInForm.notes
      });

      const bookingId = holdRes.data.booking._id;

      // 2. Confirm immediately with cash payment
      await api.confirmBooking(bookingId, { paymentStatus: 'PAID' });

      // 3. Start session immediately
      await api.startSession(bookingId);

      setNotice({
        type: 'success',
        text: `Walk-in booking created and session started on ${holdRes.data.booking.bookingReference}!`
      });
      setWalkInModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to process walk-in reservation');
    } finally {
      setActionLoading(false);
    }
  };

  // Guard: Unauthorized View
  if (!isStaffOrAdmin) {
    return (
      <div className="min-h-screen bg-gaming-dark flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 rounded-2xl glass-panel border border-gaming-rose/30 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-gaming-rose/15 text-gaming-rose flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8" />
          </div>
          <h2 className="font-display text-2xl font-bold text-white">Owner Portal Restricted</h2>
          <p className="text-sm text-slate-400">
            This dashboard requires authenticated Lounge Staff or Administrator credentials.
          </p>
          <div className="pt-2 flex justify-center space-x-3">
            <Link
              to="/"
              className="px-4 py-2.5 rounded-xl bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-xs text-slate-300 font-semibold"
            >
              Return Home
            </Link>
            <button
              type="button"
              onClick={() => onOpenAuth && onOpenAuth('login')}
              className="px-5 py-2.5 rounded-xl bg-gaming-primary hover:bg-gaming-primary/90 text-white text-xs font-semibold shadow-glow-primary"
            >
              Staff Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Calculate Metrics
  const totalRevenuePaise = bookings
    .filter((b) => b.paymentStatus === 'PAID')
    .reduce((acc, b) => acc + (b.priceSnapshot?.totalAmountPaise || 0), 0);

  const activeSessionsCount = bookings.filter((b) => b.bookingStatus === 'ACTIVE').length;
  const confirmedCount = bookings.filter((b) => b.bookingStatus === 'CONFIRMED').length;
  const availableStationsCount = stations.filter((s) => s.status === 'AVAILABLE').length;

  const filteredBookings = bookings.filter((b) => {
    const matchesStatus = statusFilter === 'ALL' || b.bookingStatus === statusFilter;
    const matchesSearch =
      !searchQuery ||
      b.bookingReference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.stationId?.identifier?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.isGuest ? b.guestInfo?.fullName : b.customerId?.fullName)
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-gaming-dark flex flex-col py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl w-full mx-auto space-y-8">
        {/* Navigation & Title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link
              to="/"
              className="text-xs font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5 mb-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Public Lounge</span>
            </Link>
            <div className="flex items-center space-x-3">
              <h1 className="font-display text-3xl font-extrabold text-white tracking-tight">
                Lounge Operations & Control
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-gaming-amber/20 text-gaming-amber border border-gaming-amber/30 text-xs font-bold font-mono">
                {user.role} PORTAL
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Live station monitoring, walk-in counter, and session lifecycle management.
            </p>
          </div>

          <div className="flex items-center space-x-3 self-start">
            <button
              type="button"
              onClick={() => setWalkInModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-gaming-primary to-gaming-accent text-white font-bold text-xs shadow-glow-primary hover:opacity-95 flex items-center space-x-1.5 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Walk-In Booking</span>
            </button>
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="p-2.5 rounded-xl bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-slate-300 hover:text-white transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-gaming-cyan' : ''}`} />
            </button>
          </div>
        </div>

        {/* Notice Alert */}
        {notice && (
          <div
            className={`p-4 rounded-xl text-xs flex items-center justify-between border animate-in slide-in-from-top-2 duration-300 ${
              notice.type === 'success'
                ? 'bg-gaming-emerald/15 border-gaming-emerald/40 text-gaming-emerald'
                : 'bg-gaming-cyan/15 border-gaming-cyan/40 text-gaming-cyan'
            }`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="font-bold ml-2">
              Dismiss
            </button>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-gaming-card border border-gaming-border space-y-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block flex items-center space-x-1.5">
              <Server className="w-4 h-4 text-gaming-cyan" />
              <span>Available Rigs</span>
            </span>
            <p className="font-display text-2xl font-black text-white">
              {availableStationsCount}{' '}
              <span className="text-xs font-normal text-slate-400">/ {stations.length} Total</span>
            </p>
            <div className="text-[11px] text-gaming-emerald font-medium">Ready for play</div>
          </div>

          <div className="p-5 rounded-2xl bg-gaming-card border border-gaming-border space-y-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block flex items-center space-x-1.5">
              <Play className="w-4 h-4 text-gaming-cyan" />
              <span>Active Sessions</span>
            </span>
            <p className="font-display text-2xl font-black text-gaming-cyan">
              {activeSessionsCount}
            </p>
            <div className="text-[11px] text-slate-400">Currently checked-in</div>
          </div>

          <div className="p-5 rounded-2xl bg-gaming-card border border-gaming-border space-y-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block flex items-center space-x-1.5">
              <Calendar className="w-4 h-4 text-gaming-accent" />
              <span>Confirmed Upcoming</span>
            </span>
            <p className="font-display text-2xl font-black text-white">{confirmedCount}</p>
            <div className="text-[11px] text-slate-400">Waiting for check-in</div>
          </div>

          <div className="p-5 rounded-2xl bg-gaming-card border border-gaming-border space-y-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 block flex items-center space-x-1.5">
              <DollarSign className="w-4 h-4 text-gaming-emerald" />
              <span>Revenue (Realized)</span>
            </span>
            <p className="font-display text-2xl font-black text-gaming-emerald">
              {formatPaiseToRupees(totalRevenuePaise)}
            </p>
            <div className="text-[11px] text-slate-400">Paid customer volume</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gaming-border space-x-8">
          <button
            type="button"
            onClick={() => setActiveTab('bookings')}
            className={`pb-3 text-sm font-bold transition-colors flex items-center space-x-2 border-b-2 ${
              activeTab === 'bookings'
                ? 'border-gaming-cyan text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Reservations & Sessions ({bookings.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stations')}
            className={`pb-3 text-sm font-bold transition-colors flex items-center space-x-2 border-b-2 ${
              activeTab === 'stations'
                ? 'border-gaming-cyan text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Station Inventory ({stations.length})</span>
          </button>
        </div>

        {/* TAB 1: BOOKINGS & SESSION CONTROLS */}
        {activeTab === 'bookings' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-gaming-card border border-gaming-border">
              <div className="flex flex-wrap items-center gap-1.5">
                {['ALL', 'ACTIVE', 'CONFIRMED', 'PENDING_HOLD', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map(
                  (st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                        statusFilter === st
                          ? 'bg-gaming-cyan/20 text-gaming-cyan border border-gaming-cyan/40'
                          : 'bg-gaming-dark text-slate-400 hover:text-white border border-gaming-border'
                      }`}
                    >
                      {st}
                    </button>
                  )
                )}
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Ref, Station, or Player..."
                  className="pl-9 pr-3 py-1.5 rounded-lg bg-gaming-dark border border-gaming-border text-xs text-white focus:outline-none focus:border-gaming-cyan w-full sm:w-64"
                />
              </div>
            </div>

            {/* Bookings Table */}
            <div className="rounded-2xl glass-panel border border-gaming-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gaming-dark/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-gaming-border">
                    <tr>
                      <th className="p-4">Reference</th>
                      <th className="p-4">Station</th>
                      <th className="p-4">Player</th>
                      <th className="p-4">Time Window</th>
                      <th className="p-4">Amount</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Session Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gaming-border">
                    {filteredBookings.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="p-8 text-center text-slate-400">
                          No reservations found matching the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredBookings.map((b) => {
                        const start = new Date(b.startTime).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        });
                        const end = new Date(b.endTime).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        });
                        const date = new Date(b.startTime).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        });

                        const playerName = b.isGuest
                          ? b.guestInfo?.fullName || 'Guest'
                          : b.customerId?.fullName || 'Customer';

                        return (
                          <tr key={b._id} className="hover:bg-gaming-card/40 transition-colors">
                            <td className="p-4 font-mono font-bold text-gaming-cyan">
                              <Link to={`/booking/${b._id}`} className="hover:underline">
                                {b.bookingReference}
                              </Link>
                            </td>
                            <td className="p-4">
                              <span className="font-bold text-white block">
                                {b.stationId?.identifier}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {b.stationId?.name}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className="font-semibold text-slate-200 block">
                                {playerName}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {b.isGuest ? 'Guest' : 'Member'}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className="text-white block font-medium">
                                {date}: {start} – {end}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {b.durationMinutes} mins
                              </span>
                            </td>
                            <td className="p-4 font-bold text-slate-200">
                              {formatPaiseToRupees(b.priceSnapshot?.totalAmountPaise || 0)}
                            </td>
                            <td className="p-4">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${
                                  b.bookingStatus === 'ACTIVE'
                                    ? 'bg-gaming-cyan/20 text-gaming-cyan border-gaming-cyan/40 animate-pulse'
                                    : b.bookingStatus === 'CONFIRMED'
                                    ? 'bg-gaming-emerald/20 text-gaming-emerald border-gaming-emerald/40'
                                    : b.bookingStatus === 'PENDING_HOLD'
                                    ? 'bg-gaming-amber/20 text-gaming-amber border-gaming-amber/40'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                              >
                                {b.bookingStatus}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end space-x-2">
                                {/* If CONFIRMED: Can Start or Mark No-Show */}
                                {b.bookingStatus === 'CONFIRMED' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleStartSession(b._id)}
                                      className="px-2.5 py-1.5 rounded-lg bg-gaming-emerald/20 hover:bg-gaming-emerald/30 text-gaming-emerald border border-gaming-emerald/40 text-[11px] font-bold flex items-center space-x-1"
                                      title="Check in customer and start session"
                                    >
                                      <Play className="w-3 h-3" />
                                      <span>Check In</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleNoShow(b._id)}
                                      className="px-2.5 py-1.5 rounded-lg bg-gaming-rose/20 hover:bg-gaming-rose/30 text-gaming-rose border border-gaming-rose/40 text-[11px] font-bold flex items-center space-x-1"
                                      title="Mark as No-Show and release slots"
                                    >
                                      <UserX className="w-3 h-3" />
                                      <span>No-Show</span>
                                    </button>
                                  </>
                                )}

                                {/* If ACTIVE: Can Complete or Extend */}
                                {b.bookingStatus === 'ACTIVE' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() =>
                                        setExtendModalState({ isOpen: true, booking: b })
                                      }
                                      className="px-2.5 py-1.5 rounded-lg bg-gaming-primary/20 hover:bg-gaming-primary/30 text-gaming-accent border border-gaming-primary/40 text-[11px] font-bold flex items-center space-x-1"
                                      title="Extend session duration"
                                    >
                                      <Clock className="w-3 h-3" />
                                      <span>Extend</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => handleCompleteSession(b._id)}
                                      className="px-2.5 py-1.5 rounded-lg bg-gaming-cyan/20 hover:bg-gaming-cyan/30 text-gaming-cyan border border-gaming-cyan/40 text-[11px] font-bold flex items-center space-x-1"
                                      title="Complete session and check out"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      <span>Check Out</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STATIONS INVENTORY MANAGEMENT */}
        {activeTab === 'stations' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">
                Configure lounge hardware and toggle availability
              </span>
              <button
                type="button"
                onClick={() => {
                  setStationForm({
                    identifier: '',
                    name: '',
                    type: 'PC',
                    hourlyRatePaise: 12000,
                    description: '',
                    status: 'AVAILABLE'
                  });
                  setStationModalState({ isOpen: true, station: null });
                }}
                className="px-3.5 py-2 rounded-xl bg-gaming-primary text-white text-xs font-bold shadow-glow-primary hover:opacity-90 flex items-center space-x-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Station</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stations.map((st) => (
                <div
                  key={st._id}
                  className="p-5 rounded-2xl bg-gaming-card border border-gaming-border space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-gaming-dark text-gaming-cyan border border-gaming-border">
                          {st.identifier}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${
                            st.status === 'AVAILABLE'
                              ? 'bg-gaming-emerald/15 text-gaming-emerald border-gaming-emerald/30'
                              : st.status === 'MAINTENANCE'
                              ? 'bg-gaming-amber/15 text-gaming-amber border-gaming-amber/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {st.status}
                        </span>
                      </div>
                      <h4 className="font-bold text-white text-base mt-1">{st.name}</h4>
                    </div>

                    <div className="text-right">
                      <span className="font-display font-bold text-white text-sm">
                        {formatPaiseToRupees(st.hourlyRatePaise)}
                      </span>
                      <span className="text-[10px] text-slate-400 block">/ hour</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2">{st.description || 'No description'}</p>

                  <div className="flex items-center justify-between pt-2 border-t border-gaming-border">
                    <span className="text-[11px] text-slate-400 font-mono">{st.type} Gaming</span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStationForm({
                            identifier: st.identifier,
                            name: st.name,
                            type: st.type,
                            hourlyRatePaise: st.hourlyRatePaise,
                            description: st.description || '',
                            status: st.status
                          });
                          setStationModalState({ isOpen: true, station: st });
                        }}
                        className="p-1.5 rounded-lg bg-gaming-dark hover:bg-gaming-cardHover border border-gaming-border text-slate-300 hover:text-white"
                        title="Edit Station Details"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {st.status !== 'DEACTIVATED' && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (window.confirm(`Deactivate station ${st.identifier}?`)) {
                              await api.deactivateStation(st._id);
                              fetchData();
                            }
                          }}
                          className="p-1.5 rounded-lg bg-gaming-dark hover:bg-gaming-cardHover border border-gaming-border text-slate-400 hover:text-gaming-rose"
                          title="Deactivate Station"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODAL: ADD / EDIT STATION */}
        {stationModalState.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="max-w-md w-full bg-gaming-card border border-gaming-border rounded-2xl p-6 space-y-4 shadow-2xl">
              <h3 className="text-lg font-bold text-white">
                {stationModalState.station ? 'Edit Station' : 'Create New Station'}
              </h3>
              <form onSubmit={handleSaveStation} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Station Identifier *</label>
                  <input
                    type="text"
                    required
                    disabled={!!stationModalState.station}
                    value={stationForm.identifier}
                    onChange={(e) =>
                      setStationForm({ ...stationForm, identifier: e.target.value.toUpperCase() })
                    }
                    placeholder="PC-07"
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Station Name *</label>
                  <input
                    type="text"
                    required
                    value={stationForm.name}
                    onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
                    placeholder="Apex Predator Rig #7"
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">Hardware Type</label>
                    <select
                      value={stationForm.type}
                      onChange={(e) => setStationForm({ ...stationForm, type: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                    >
                      <option value="PC">PC</option>
                      <option value="PS5">PS5</option>
                      <option value="XBOX">XBOX</option>
                      <option value="VR">VR</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Hourly Rate (Paise) *</label>
                    <input
                      type="number"
                      required
                      min="100"
                      value={stationForm.hourlyRatePaise}
                      onChange={(e) =>
                        setStationForm({ ...stationForm, hourlyRatePaise: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                    />
                    <span className="text-[10px] text-gaming-cyan mt-0.5 block">
                      = {formatPaiseToRupees(Number(stationForm.hourlyRatePaise || 0))} / hr
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Status</label>
                  <select
                    value={stationForm.status}
                    onChange={(e) => setStationForm({ ...stationForm, status: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                  >
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="DEACTIVATED">DEACTIVATED</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Description</label>
                  <textarea
                    rows="2"
                    value={stationForm.description}
                    onChange={(e) => setStationForm({ ...stationForm, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                  />
                </div>

                <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gaming-border">
                  <button
                    type="button"
                    onClick={() => setStationModalState({ isOpen: false, station: null })}
                    className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="px-5 py-2 rounded-xl bg-gaming-primary text-white font-bold"
                  >
                    Save Station
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: WALK-IN BOOKING DESK */}
        {walkInModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="max-w-md w-full bg-gaming-card border border-gaming-border rounded-2xl p-6 space-y-4 shadow-2xl">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Plus className="w-5 h-5 text-gaming-cyan" />
                <span>Immediate Walk-In Desk</span>
              </h3>
              <p className="text-xs text-slate-400">
                Book and start a session instantly for an in-person customer with cash payment.
              </p>

              <form onSubmit={handleWalkInSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Select Station *</label>
                  <select
                    required
                    value={walkInForm.stationId}
                    onChange={(e) => setWalkInForm({ ...walkInForm, stationId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                  >
                    <option value="">-- Choose Station --</option>
                    {stations
                      .filter((s) => s.status === 'AVAILABLE')
                      .map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.identifier} - {s.name} ({formatPaiseToRupees(s.hourlyRatePaise)}/hr)
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={walkInForm.fullName}
                    onChange={(e) => setWalkInForm({ ...walkInForm, fullName: e.target.value })}
                    placeholder="Walk-In Player"
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Duration</label>
                  <select
                    value={walkInForm.durationMinutes}
                    onChange={(e) =>
                      setWalkInForm({ ...walkInForm, durationMinutes: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-gaming-dark border border-gaming-border text-white"
                  >
                    <option value={30}>30 Minutes</option>
                    <option value={60}>1 Hour</option>
                    <option value={90}>1.5 Hours</option>
                    <option value={120}>2 Hours</option>
                    <option value={180}>3 Hours</option>
                    <option value={240}>4 Hours</option>
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-gaming-dark border border-gaming-border text-gaming-emerald flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>Will be auto-confirmed as WALK_IN_CASH and checked in immediately.</span>
                </div>

                <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gaming-border">
                  <button
                    type="button"
                    onClick={() => setWalkInModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-gaming-primary to-gaming-cyan text-white font-bold"
                  >
                    {actionLoading ? 'Allocating...' : 'Start Walk-In'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: EXTEND SESSION */}
        {extendModalState.isOpen && extendModalState.booking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="max-w-sm w-full bg-gaming-card border border-gaming-border rounded-2xl p-6 space-y-4 shadow-2xl">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Clock className="w-5 h-5 text-gaming-accent" />
                <span>Extend Gaming Session</span>
              </h3>
              <p className="text-xs text-slate-400">
                Adding extra time checks subsequent 15-minute slot availability automatically.
              </p>

              <form onSubmit={handleExtendSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="text-slate-400 block mb-2">Extension Time</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[15, 30, 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setExtendMinutes(m)}
                        className={`py-2 rounded-xl border font-bold ${
                          extendMinutes === m
                            ? 'bg-gaming-accent/20 border-gaming-accent text-white'
                            : 'bg-gaming-dark border-gaming-border text-slate-300'
                        }`}
                      >
                        +{m}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setExtendModalState({ isOpen: false, booking: null })}
                    className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="px-5 py-2 rounded-xl bg-gaming-accent text-white font-bold"
                  >
                    {actionLoading ? 'Extending...' : 'Confirm Extension'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
