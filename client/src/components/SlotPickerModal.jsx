import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Lock,
  Wrench,
  Loader2,
  ChevronRight,
  User,
  Mail,
  Phone
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPaiseToRupees } from '../utils/formatters';

const DURATION_OPTIONS = [
  { label: '30 mins', minutes: 30 },
  { label: '45 mins', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: '1.5 hours', minutes: 90 },
  { label: '2 hours', minutes: 120 },
  { label: '3 hours', minutes: 180 },
  { label: '4 hours (Max)', minutes: 240 }
];

export default function SlotPickerModal({
  station,
  isOpen,
  onClose,
  onBookingSuccess
}) {
  const { user, isAuthenticated } = useAuth();

  // Date selection: next 7 days
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(null);

  // Selection state
  const [selectedStartSlot, setSelectedStartSlot] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState(60); // minutes default
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState(null);

  // Guest details form
  const [guestInfo, setGuestInfo] = useState({
    fullName: '',
    email: '',
    phone: ''
  });

  // Initialize dates
  useEffect(() => {
    const list = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateString = `${yyyy}-${mm}-${dd}`;
      const label =
        i === 0
          ? 'Today'
          : i === 1
          ? 'Tomorrow'
          : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      list.push({ dateString, label, fullDate: d });
    }
    setDates(list);
    if (list.length > 0) {
      setSelectedDate(list[0].dateString);
    }
  }, []);

  // Fetch slot availability when station or selected date changes
  const fetchAvailability = async () => {
    if (!station || !selectedDate) return;
    try {
      setLoadingSlots(true);
      setSlotsError(null);
      setSelectedStartSlot(null);
      setBookingError(null);

      const res = await api.getAvailability({
        stationId: station._id || station.identifier,
        date: selectedDate
      });

      const stationData = res.data?.stations?.find(
        (s) => s.stationId === station._id || s.identifier === station.identifier
      );
      setSlots(stationData?.slots || []);
    } catch (err) {
      setSlotsError(err.message || 'Failed to load availability for this date');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (isOpen && station && selectedDate) {
      fetchAvailability();
    }
  }, [isOpen, station, selectedDate]);

  if (!isOpen || !station) return null;

  // Format 24-hr ISO string to readable local time (e.g. 10:00 AM)
  const formatSlotTime = (isoString) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  // Check if a slot is in the past for today
  const isPastSlot = (isoString) => {
    return new Date(isoString).getTime() <= Date.now();
  };

  // Validate if duration fits into contiguous available slots
  const getSelectedInterval = () => {
    if (!selectedStartSlot) return null;
    const startIndex = slots.findIndex((s) => s.startTime === selectedStartSlot.startTime);
    if (startIndex === -1) return null;

    const slotsCountNeeded = selectedDuration / 15;
    const endIndex = startIndex + slotsCountNeeded;
    const requiredSlots = slots.slice(startIndex, endIndex);

    if (requiredSlots.length < slotsCountNeeded) {
      return {
        valid: false,
        reason: 'Selected duration extends past lounge closing hours (11:00 PM).'
      };
    }

    const occupiedSlot = requiredSlots.find((s) => !s.isAvailable || isPastSlot(s.startTime));
    if (occupiedSlot) {
      return {
        valid: false,
        reason: `Duration conflicts with an occupied or past slot at ${formatSlotTime(occupiedSlot.startTime)}.`
      };
    }

    const endTime = requiredSlots[requiredSlots.length - 1].endTime;
    return {
      valid: true,
      startTime: selectedStartSlot.startTime,
      endTime,
      requiredSlots
    };
  };

  const interval = getSelectedInterval();

  // Price calculations in paise & INR
  const totalAmountPaise = Math.round((station.hourlyRatePaise * selectedDuration) / 60);
  const depositAmountPaise = Math.round(totalAmountPaise * 0.5);

  // Submit booking hold request
  const handleSubmitHold = async (e) => {
    e.preventDefault();
    if (!interval || !interval.valid) {
      setBookingError(interval?.reason || 'Please select a valid available time slot');
      return;
    }

    // Guest validation
    if (!isAuthenticated) {
      if (!guestInfo.fullName.trim() || !guestInfo.email.trim()) {
        setBookingError('Full name and email address are required for guest booking');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setBookingError(null);

      const payload = {
        stationId: station._id || station.identifier,
        startTime: interval.startTime,
        endTime: interval.endTime,
        isGuest: !isAuthenticated,
        guestInfo: !isAuthenticated ? guestInfo : undefined
      };

      const res = await api.createBookingHold(payload);

      if (onBookingSuccess) {
        onBookingSuccess(res.data.booking, res.data.guestAccessToken);
      }
      onClose();
    } catch (err) {
      if (err.status === 409 || err.code === 'SLOT_UNAVAILABLE') {
        setBookingError(
          'Slot Conflict: One or more selected time slots were just reserved by another customer. Please pick an alternative time.'
        );
        fetchAvailability(); // Refresh live availability
      } else {
        setBookingError(err.message || 'Failed to reserve time slots. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-gaming-card border border-gaming-border rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-gaming-border bg-gaming-card/95 flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-xl bg-gaming-dark border border-gaming-cyan/30 flex items-center justify-center text-gaming-cyan shadow-glow-cyan">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-gaming-primary/20 text-gaming-accent border border-gaming-primary/30">
                  {station.identifier}
                </span>
                <span className="text-xs text-slate-400">
                  {formatPaiseToRupees(station.hourlyRatePaise)} / hour
                </span>
              </div>
              <h3 className="font-display text-lg sm:text-xl font-bold text-white mt-0.5">
                Reserve {station.name}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-gaming-border transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {/* Error Banner */}
          {bookingError && (
            <div className="p-4 rounded-xl bg-gaming-rose/15 border border-gaming-rose/40 text-gaming-rose flex items-start space-x-3 text-sm animate-in shake duration-300">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Reservation Notice</p>
                <p className="text-xs text-rose-300 mt-0.5 leading-relaxed">{bookingError}</p>
              </div>
            </div>
          )}

          {/* 1. Date Selector */}
          <div>
            <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2.5 flex items-center space-x-1.5">
              <Calendar className="w-4 h-4 text-gaming-cyan" />
              <span>1. Choose Date</span>
            </label>
            <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-thin">
              {dates.map((d) => {
                const isSelected = selectedDate === d.dateString;
                return (
                  <button
                    key={d.dateString}
                    type="button"
                    onClick={() => setSelectedDate(d.dateString)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                      isSelected
                        ? 'bg-gaming-primary text-white border-gaming-primary shadow-glow-primary'
                        : 'bg-gaming-dark text-slate-300 border-gaming-border hover:border-slate-600'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Duration Selector */}
          <div>
            <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2.5 flex items-center space-x-1.5">
              <Clock className="w-4 h-4 text-gaming-accent" />
              <span>2. Choose Booking Duration</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((opt) => {
                const isSelected = selectedDuration === opt.minutes;
                return (
                  <button
                    key={opt.minutes}
                    type="button"
                    onClick={() => setSelectedDuration(opt.minutes)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                      isSelected
                        ? 'bg-gaming-accent/20 text-white border-gaming-accent shadow-glow-primary'
                        : 'bg-gaming-dark text-slate-300 border-gaming-border hover:border-slate-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Slot Matrix */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 flex items-center space-x-1.5">
                <Clock className="w-4 h-4 text-gaming-cyan" />
                <span>3. Select Start Time (15-Min Intervals)</span>
              </label>

              {/* Legend */}
              <div className="hidden sm:flex items-center space-x-3 text-[11px] text-slate-400">
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-gaming-cyan" />
                  <span>Available</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-gaming-amber" />
                  <span>Held</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-gaming-rose" />
                  <span>Booked</span>
                </span>
              </div>
            </div>

            {loadingSlots ? (
              <div className="p-8 rounded-xl bg-gaming-dark border border-gaming-border flex items-center justify-center space-x-2 text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-gaming-cyan" />
                <span>Querying authoritative 15-minute slot availability...</span>
              </div>
            ) : slotsError ? (
              <div className="p-4 rounded-xl bg-gaming-rose/10 border border-gaming-rose/30 text-gaming-rose text-xs">
                {slotsError}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-56 overflow-y-auto p-1 bg-gaming-dark/60 rounded-xl border border-gaming-border">
                {slots.map((slot) => {
                  const past = isPastSlot(slot.startTime);
                  const isAvailable = slot.isAvailable && !past;
                  const isSelected = selectedStartSlot?.startTime === slot.startTime;

                  let badgeColor = 'bg-gaming-dark border-gaming-border text-slate-300 hover:border-gaming-cyan hover:text-gaming-cyan';
                  if (isSelected) {
                    badgeColor = 'bg-gaming-cyan/20 border-gaming-cyan text-gaming-cyan shadow-glow-cyan font-bold';
                  } else if (past) {
                    badgeColor = 'opacity-40 bg-gaming-dark/40 border-transparent text-slate-600 cursor-not-allowed';
                  } else if (slot.status === 'HELD') {
                    badgeColor = 'opacity-50 bg-gaming-amber/10 border-gaming-amber/30 text-gaming-amber cursor-not-allowed';
                  } else if (slot.status === 'CONFIRMED') {
                    badgeColor = 'opacity-50 bg-gaming-rose/10 border-gaming-rose/30 text-gaming-rose cursor-not-allowed';
                  } else if (slot.status === 'MAINTENANCE') {
                    badgeColor = 'opacity-50 bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed';
                  }

                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => setSelectedStartSlot(slot)}
                      className={`p-2 rounded-lg text-xs border text-center transition-all ${badgeColor}`}
                    >
                      <span className="block font-medium">{formatSlotTime(slot.startTime)}</span>
                      <span className="text-[9px] block uppercase opacity-75 mt-0.5">
                        {past ? 'Past' : slot.status === 'AVAILABLE' ? 'Open' : slot.status}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Customer Info (if Guest) */}
          {!isAuthenticated ? (
            <div className="p-4 rounded-xl bg-gaming-dark border border-gaming-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 flex items-center space-x-1.5">
                  <User className="w-4 h-4 text-gaming-primary" />
                  <span>4. Guest Customer Details</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Or log in to save to your gaming account
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={guestInfo.fullName}
                    onChange={(e) => setGuestInfo({ ...guestInfo, fullName: e.target.value })}
                    placeholder="Alex Mercer"
                    className="w-full px-3 py-2 rounded-lg bg-gaming-card border border-gaming-border text-xs text-white focus:outline-none focus:border-gaming-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={guestInfo.email}
                    onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                    placeholder="alex@gaming.com"
                    className="w-full px-3 py-2 rounded-lg bg-gaming-card border border-gaming-border text-xs text-white focus:outline-none focus:border-gaming-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  value={guestInfo.phone}
                  onChange={(e) => setGuestInfo({ ...guestInfo, phone: e.target.value })}
                  placeholder="+91 9876543210"
                  className="w-full px-3 py-2 rounded-lg bg-gaming-card border border-gaming-border text-xs text-white focus:outline-none focus:border-gaming-primary"
                />
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-gaming-dark/80 border border-gaming-border flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded-lg bg-gaming-primary/20 text-gaming-accent flex items-center justify-center font-bold">
                  {user.fullName?.charAt(0)}
                </div>
                <div>
                  <span className="text-white font-semibold block">{user.fullName}</span>
                  <span className="text-slate-400 text-[11px]">{user.email}</span>
                </div>
              </div>
              <span className="text-gaming-emerald text-[11px] font-medium flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Verified Customer</span>
              </span>
            </div>
          )}

          {/* 5. Summary & Price Breakdown */}
          {interval && interval.valid && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-gaming-primary/10 via-gaming-accent/10 to-gaming-cyan/10 border border-gaming-primary/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 block font-medium">Reservation Summary</span>
                <p className="text-sm font-bold text-white">
                  {formatSlotTime(interval.startTime)} – {formatSlotTime(interval.endTime)} ({selectedDuration} mins)
                </p>
                <p className="text-xs text-slate-400">
                  {station.name} • 10-Minute Hold Window
                </p>
              </div>

              <div className="text-right flex sm:flex-col justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-gaming-border">
                <div>
                  <span className="text-xs text-slate-400 block">Total Amount</span>
                  <span className="font-display text-xl font-extrabold text-white">
                    {formatPaiseToRupees(totalAmountPaise)}
                  </span>
                </div>
                <div className="text-[11px] text-gaming-cyan mt-0.5">
                  Deposit: {formatPaiseToRupees(depositAmountPaise)} (50%)
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 sm:p-6 border-t border-gaming-border bg-gaming-card/95 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!interval || !interval.valid || isSubmitting}
            onClick={handleSubmitHold}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-gaming-primary to-gaming-cyan hover:opacity-95 shadow-glow-cyan transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Acquiring Lock...</span>
              </>
            ) : (
              <>
                <span>Hold Slots (10 Mins)</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
