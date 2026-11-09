import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  Calendar,
  CreditCard,
  Copy,
  Check,
  AlertTriangle,
  ArrowLeft,
  XCircle,
  ShieldCheck,
  Gamepad2,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { api } from '../services/api';
import { formatPaiseToRupees } from '../utils/formatters';

export default function BookingConfirmationPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Initial booking data might be in location.state
  const [booking, setBooking] = useState(location.state?.booking || null);
  const [guestToken, setGuestToken] = useState(location.state?.guestAccessToken || null);
  const [loading, setLoading] = useState(!location.state?.booking);
  const [error, setError] = useState(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // Remaining hold time in seconds
  const [timeLeft, setTimeLeft] = useState(null);

  // Mock Payment Sandbox state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSession, setPaymentSession] = useState(null);
  const [isInitiatingPayment, setIsInitiatingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState(null);

  const fetchBooking = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getBookingById(id);
      setBooking(res.data);
    } catch (err) {
      setError(err.message || 'Unable to retrieve booking details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If no booking or stationId is not populated with station name, fetch full details from backend
    if (!booking || typeof booking.stationId === 'string' || !booking.stationId?.name) {
      fetchBooking();
    }
  }, [id]);

  // Hold expiration countdown timer
  useEffect(() => {
    if (!booking || booking.bookingStatus !== 'PENDING_HOLD' || !booking.holdExpiresAt) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expires = new Date(booking.holdExpiresAt).getTime();
      const diffSecs = Math.max(0, Math.floor((expires - now) / 1000));
      setTimeLeft(diffSecs);

      if (diffSecs <= 0 && booking.bookingStatus === 'PENDING_HOLD') {
        fetchBooking(); // Refresh to catch EXPIRED status from backend
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [booking?.holdExpiresAt, booking?.bookingStatus]);

  // Copy to clipboard helpers
  const handleCopy = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'ref') {
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // Initiate mock payment session
  const handleOpenPayment = async () => {
    try {
      setIsInitiatingPayment(true);
      setActionMessage(null);
      setPaymentError(null);
      const res = await api.initiatePayment({
        bookingId: booking._id,
        guestAccessToken: guestToken
      });
      setPaymentSession(res.data);
      setPaymentModalOpen(true);
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to initiate mock payment' });
    } finally {
      setIsInitiatingPayment(false);
    }
  };

  // Simulate payment outcome in the sandbox (triggers verified webhook on backend)
  const handleSimulatePayment = async (outcome) => {
    try {
      setIsConfirming(true);
      setPaymentError(null);
      const res = await api.simulatePayment({
        paymentReference: paymentSession.paymentReference,
        outcome,
        failureReason: outcome === 'FAILURE' ? 'Simulated card decline' : null
      });

      if (res.data?.booking) {
        const updatedBooking = res.data.booking;
        if (typeof updatedBooking.stationId === 'string' && typeof booking?.stationId === 'object') {
          updatedBooking.stationId = booking.stationId;
        }
        setBooking(updatedBooking);
      }

      if (outcome === 'SUCCESS') {
        setPaymentModalOpen(false);
        setActionMessage({
          type: 'success',
          text: 'Payment verified via signed webhook! Your gaming rig is ready.'
        });
      } else {
        setPaymentError('Simulated payment was declined. Your hold remains active.');
      }
    } catch (err) {
      setPaymentError(err.message || 'Payment simulation failed');
    } finally {
      setIsConfirming(false);
    }
  };

  // Release/Cancel hold
  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel and release this reservation?')) return;
    try {
      setIsCancelling(true);
      setActionMessage(null);
      const res = await api.releaseBookingHold(booking._id, 'Customer cancelled');
      const updatedBooking = res.data;
      if (typeof updatedBooking.stationId === 'string' && typeof booking?.stationId === 'object') {
        updatedBooking.stationId = booking.stationId;
      }
      setBooking(updatedBooking);
      setActionMessage({ type: 'info', text: 'Reservation has been cancelled and slots released.' });
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to cancel reservation' });
    } finally {
      setIsCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gaming-dark flex items-center justify-center p-4">
        <div className="flex flex-col items-center space-y-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-gaming-cyan" />
          <p className="text-sm">Loading booking pass...</p>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-gaming-dark flex items-center justify-center p-4">
        <div className="p-8 rounded-2xl bg-gaming-card border border-gaming-rose/30 text-center max-w-md w-full space-y-4">
          <XCircle className="w-12 h-12 text-gaming-rose mx-auto" />
          <h2 className="text-xl font-bold text-white">Booking Not Found</h2>
          <p className="text-sm text-slate-400">{error || 'Invalid booking identifier'}</p>
          <Link
            to="/"
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-gaming-primary text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Lounge</span>
          </Link>
        </div>
      </div>
    );
  }

  const isHold = booking.bookingStatus === 'PENDING_HOLD';
  const isConfirmed = booking.bookingStatus === 'CONFIRMED' || booking.bookingStatus === 'ACTIVE';
  const isExpired = booking.bookingStatus === 'EXPIRED';
  const isCancelled = booking.bookingStatus === 'CANCELLED';

  const formatTimer = (seconds) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const startTimeStr = new Date(booking.startTime).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const endTimeStr = new Date(booking.endTime).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const dateStr = new Date(booking.startTime).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="min-h-screen bg-gaming-dark flex flex-col py-10 px-4 sm:px-6">
      <div className="max-w-2xl w-full mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="text-xs font-semibold text-slate-400 hover:text-white flex items-center space-x-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Stations</span>
          </Link>
          <button
            type="button"
            onClick={fetchBooking}
            className="text-xs text-slate-400 hover:text-white flex items-center space-x-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* Action / Error Banner */}
        {actionMessage && (
          <div
            className={`p-4 rounded-xl border text-xs flex items-center space-x-2 animate-in fade-in duration-200 ${
              actionMessage.type === 'success'
                ? 'bg-gaming-emerald/15 border-gaming-emerald/40 text-gaming-emerald'
                : actionMessage.type === 'error'
                ? 'bg-gaming-rose/15 border-gaming-rose/40 text-gaming-rose'
                : 'bg-gaming-cyan/15 border-gaming-cyan/40 text-gaming-cyan'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{actionMessage.text}</span>
          </div>
        )}

        {/* Main Pass Container */}
        <div className="rounded-2xl glass-panel border border-gaming-border overflow-hidden shadow-2xl relative">
          {/* Status Header Banner */}
          <div
            className={`p-6 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              isConfirmed
                ? 'bg-gaming-emerald/15 border-gaming-emerald/30 text-gaming-emerald'
                : isHold
                ? 'bg-gaming-amber/15 border-gaming-amber/30 text-gaming-amber'
                : isExpired
                ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                : 'bg-gaming-rose/15 border-gaming-rose/30 text-gaming-rose'
            }`}
          >
            <div className="flex items-center space-x-3">
              {isConfirmed ? (
                <div className="w-12 h-12 rounded-xl bg-gaming-emerald/20 text-gaming-emerald flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
              ) : isHold ? (
                <div className="w-12 h-12 rounded-xl bg-gaming-amber/20 text-gaming-amber flex items-center justify-center font-bold animate-pulse">
                  <Clock className="w-7 h-7" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-xl bg-gaming-rose/20 text-gaming-rose flex items-center justify-center font-bold">
                  <AlertTriangle className="w-7 h-7" />
                </div>
              )}
              <div>
                <span className="text-xs uppercase tracking-wider font-bold block">
                  {isConfirmed ? 'Reservation Confirmed' : isHold ? 'Temporary 10-Min Hold' : `Booking ${booking.bookingStatus}`}
                </span>
                <h1 className="font-display text-xl font-extrabold text-white">
                  {isConfirmed
                    ? 'Rig Ready For Check-in'
                    : isHold
                    ? 'Complete Confirmation'
                    : `Status: ${booking.bookingStatus}`}
                </h1>
              </div>
            </div>

            {/* Countdown Clock for Hold */}
            {isHold && timeLeft !== null && (
              <div className="px-4 py-2 rounded-xl bg-gaming-dark/80 border border-gaming-amber/40 text-center">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Hold Expires In</span>
                <span className="font-mono text-xl font-extrabold text-gaming-amber">
                  {formatTimer(timeLeft)}
                </span>
              </div>
            )}
          </div>

          {/* Pass Details Body */}
          <div className="p-6 sm:p-8 space-y-6">
            {/* Booking Reference Bar */}
            <div className="p-4 rounded-xl bg-gaming-dark border border-gaming-border flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
                  Booking Reference
                </span>
                <span className="font-mono text-lg font-bold text-gaming-cyan tracking-wider">
                  {booking.bookingReference}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(booking.bookingReference, 'ref')}
                className="px-3 py-1.5 rounded-lg bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-xs text-slate-300 hover:text-white flex items-center space-x-1.5 transition-colors"
              >
                {copiedRef ? <Check className="w-3.5 h-3.5 text-gaming-emerald" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedRef ? 'Copied' : 'Copy Code'}</span>
              </button>
            </div>

            {/* Station and Time Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-gaming-card border border-gaming-border space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block flex items-center space-x-1">
                  <Gamepad2 className="w-3.5 h-3.5 text-gaming-cyan" />
                  <span>Station Details</span>
                </span>
                <p className="text-white font-bold text-base">
                  {booking.stationId?.name || 'Gaming Station'}
                </p>
                <p className="text-xs text-slate-400 font-mono">
                  Station Code: {booking.stationId?.identifier || 'N/A'} • {booking.stationId?.type}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-gaming-card border border-gaming-border space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-gaming-accent" />
                  <span>Time Slot</span>
                </span>
                <p className="text-white font-bold text-base">
                  {startTimeStr} – {endTimeStr}
                </p>
                <p className="text-xs text-slate-400">
                  {dateStr} ({booking.durationMinutes} mins)
                </p>
              </div>
            </div>

            {/* Price Snapshot */}
            <div className="p-4 rounded-xl bg-gaming-dark/60 border border-gaming-border space-y-2">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
                Price Breakdown (Integer Paise Engine)
              </span>
              <div className="flex justify-between text-xs text-slate-300 pt-1">
                <span>Hourly Rate</span>
                <span>{formatPaiseToRupees(booking.priceSnapshot?.hourlyRatePaise || 0)} / hr</span>
              </div>
              <div className="flex justify-between text-xs text-slate-300">
                <span>Total Calculated Amount</span>
                <span className="font-bold text-white">
                  {formatPaiseToRupees(booking.priceSnapshot?.totalAmountPaise || 0)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-gaming-cyan pt-1 border-t border-gaming-border">
                <span>Deposit Required (50%)</span>
                <span className="font-bold">
                  {formatPaiseToRupees(booking.priceSnapshot?.depositAmountPaise || 0)}
                </span>
              </div>
            </div>

            {/* Guest Management Token Box (if applicable) */}
            {guestToken && (
              <div className="p-4 rounded-xl bg-gaming-primary/10 border border-gaming-primary/30 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-gaming-primary" />
                    <span>Guest Access Secret Token</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(guestToken, 'token')}
                    className="text-gaming-accent hover:underline flex items-center space-x-1"
                  >
                    {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedToken ? 'Copied' : 'Copy Token'}</span>
                  </button>
                </div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  Keep this secret key saved. You can use it along with your reference to retrieve and manage your guest booking at any time.
                </p>
                <code className="block p-2 rounded bg-gaming-dark font-mono text-[10px] text-slate-300 break-all select-all">
                  {guestToken}
                </code>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-gaming-border bg-gaming-card/95 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <Link
              to="/my-bookings"
              className="text-xs font-semibold text-slate-400 hover:text-white text-center sm:text-left transition-colors"
            >
              View My Reservations
            </Link>

            <div className="flex items-center justify-end space-x-3">
              {isHold && (
                <>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isCancelling || isConfirming}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-gaming-rose border border-gaming-border hover:bg-gaming-dark transition-colors"
                  >
                    {isCancelling ? 'Releasing...' : 'Release Hold'}
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenPayment}
                    disabled={isInitiatingPayment || (timeLeft !== null && timeLeft <= 0)}
                    className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-gaming-cyan via-gaming-accent to-purple-600 hover:opacity-95 shadow-glow-cyan transition-all flex items-center space-x-2"
                  >
                    {isInitiatingPayment ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4" />
                        <span>Pay & Confirm (Sandbox)</span>
                      </>
                    )}
                  </button>
                </>
              )}

              {isConfirmed && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-gaming-rose border border-gaming-border hover:bg-gaming-dark transition-colors"
                >
                  {isCancelling ? 'Cancelling...' : 'Cancel Booking'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mock Payment Sandbox Modal */}
      {paymentModalOpen && paymentSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl bg-gaming-card border border-gaming-border shadow-2xl p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gaming-cyan/15 border border-gaming-cyan/30 flex items-center justify-center text-gaming-cyan">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-display font-bold text-white text-base">Payment Simulator</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      Sandbox
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">Secure local event simulator</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                disabled={isConfirming}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-gaming-dark transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Explanatory Notice */}
            <div className="p-3 rounded-xl bg-gaming-dark/70 border border-gaming-border text-[11px] text-slate-300 leading-relaxed">
              <span className="font-semibold text-gaming-cyan block mb-1">Development Verification Mode:</span>
              This initiates a test event signed with server-side HMAC-SHA256 credentials to simulate a real payment provider webhook. No real payment or money is processed.
            </div>

            {/* Payment Summary */}
            <div className="p-4 rounded-xl bg-gaming-dark border border-gaming-border space-y-2">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Station Rig</span>
                <span className="font-semibold text-white">{booking.stationId?.name}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Payment Reference</span>
                <span className="font-mono text-gaming-cyan">{paymentSession.paymentReference}</span>
              </div>
              <div className="border-t border-gaming-border pt-2 flex justify-between items-center">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Amount Due</span>
                <span className="font-mono text-lg font-extrabold text-white">
                  {formatPaiseToRupees(paymentSession.amountPaise)}
                </span>
              </div>
            </div>

            {/* Error Banner */}
            {paymentError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}

            {/* Simulation Action Buttons */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={() => handleSimulatePayment('SUCCESS')}
                disabled={isConfirming}
                className="w-full py-3 rounded-xl font-semibold text-xs uppercase tracking-wider text-white bg-gradient-to-r from-gaming-emerald to-teal-500 hover:opacity-95 shadow-glow-emerald transition-all flex items-center justify-center space-x-2"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing Webhook & Verifying...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Simulate Successful Payment</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSimulatePayment('FAILURE')}
                disabled={isConfirming}
                className="w-full py-2.5 rounded-xl font-semibold text-xs uppercase tracking-wider text-rose-400 hover:text-white border border-rose-500/30 hover:bg-rose-500/20 transition-colors flex items-center justify-center space-x-2"
              >
                <XCircle className="w-4 h-4" />
                <span>Simulate Payment Failure</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                disabled={isConfirming}
                className="w-full py-2 text-center text-xs text-slate-400 hover:text-white transition-colors"
              >
                Cancel and Return to Pass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
