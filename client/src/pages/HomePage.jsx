import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HealthStatusBadge from '../components/HealthStatusBadge';
import StationCard from '../components/StationCard';
import StationFilter from '../components/StationFilter';
import StationDetailModal from '../components/StationDetailModal';
import SlotPickerModal from '../components/SlotPickerModal';
import { api } from '../services/api';
import {
  Clock,
  ShieldCheck,
  Cpu,
  Zap,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Server,
  ArrowRight
} from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();

  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedType, setSelectedType] = useState('ALL');

  // Modal states
  const [specsModalStation, setSpecsModalStation] = useState(null);
  const [slotPickerStation, setSlotPickerStation] = useState(null);

  const fetchStations = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getStations();
      setStations(res.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch stations from server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStations();
  }, []);

  const filteredStations = stations.filter((station) => {
    if (selectedType === 'ALL') return true;
    return station.type === selectedType;
  });

  const handleBookTrigger = (station) => {
    setSpecsModalStation(null); // close detail modal if open
    setSlotPickerStation(station); // open interactive slot picker
  };

  const handleBookingCreated = (booking, guestAccessToken) => {
    // Navigate straight to the confirmation page
    navigate(`/booking/${booking._id}`, {
      state: {
        booking,
        guestAccessToken
      }
    });
  };

  return (
    <div className="space-y-10">
      {/* Hero Section */}
      <div className="relative rounded-3xl overflow-hidden glass-panel p-8 md:p-12 border border-gaming-border shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gaming-accent/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-gaming-cyan/15 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
          <div className="lg:col-span-2 space-y-5">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-gaming-primary/20 border border-gaming-primary/30 text-gaming-accent text-xs font-semibold uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5" />
              <span>Zero Double Bookings • Discrete 15-Minute ACID Engine</span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight">
              Level Up Your Play at <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-gaming-cyan via-gaming-accent to-purple-400">
                DND Gaming Hub
              </span>
            </h1>

            <p className="text-slate-300 text-base sm:text-lg max-w-2xl leading-relaxed">
              Reserve liquid-cooled RTX 4080 battle stations and PlayStation 5 4K 120Hz OLED lounges in flexible 15-minute quanta. Real-time availability with guaranteed zero double-bookings.
            </p>

            <div className="flex flex-wrap gap-4 pt-2">
              <a
                href="#stations"
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-gaming-primary to-gaming-cyan text-white font-bold shadow-glow-cyan hover:opacity-95 transition-all text-sm flex items-center space-x-2"
              >
                <span>Choose Station & Slot</span>
                <ArrowRight className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={() => {
                  if (stations.length > 0) {
                    handleBookTrigger(stations[0]);
                  }
                }}
                className="px-6 py-3 rounded-xl bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-slate-200 font-semibold transition-all text-sm"
              >
                Instant 15-Min Booking
              </button>
            </div>
          </div>

          {/* Health Status Widget */}
          <div className="w-full">
            <HealthStatusBadge />
          </div>
        </div>
      </div>

      {/* Feature Badges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-gaming-card border border-gaming-border hover:border-gaming-cyan/40 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-gaming-cyan/15 flex items-center justify-center text-gaming-cyan mb-4">
            <Clock className="w-5 h-5" />
          </div>
          <h3 className="text-white font-bold text-base mb-1">15-Minute Discrete Slots</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Reserve exact durations from 30 minutes up to 4 hours with server-side time boundary enforcement.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-gaming-card border border-gaming-border hover:border-gaming-emerald/40 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-gaming-emerald/15 flex items-center justify-center text-gaming-emerald mb-4">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-white font-bold text-base mb-1">ACID Concurrency Engine</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Unique compound index constraints guarantee zero double bookings directly at the database engine.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-gaming-card border border-gaming-border hover:border-gaming-accent/40 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-gaming-accent/15 flex items-center justify-center text-gaming-accent mb-4">
            <Cpu className="w-5 h-5" />
          </div>
          <h3 className="text-white font-bold text-base mb-1">Integer Paise Precision</h3>
          <p className="text-slate-400 text-sm leading-relaxed">
            Zero floating-point rounding errors. Every rate and price calculation executes deterministically in integer paise.
          </p>
        </div>
      </div>

      {/* Dynamic Stations Section */}
      <section id="stations" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-gaming-cyan" />
              <h2 className="font-display text-2xl font-bold text-white">Live Station Inventory</h2>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Select any station to check live availability or view hardware specifications.
            </p>
          </div>

          <button
            type="button"
            onClick={fetchStations}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-xl bg-gaming-card hover:bg-gaming-cardHover border border-gaming-border text-xs text-slate-300 hover:text-white transition-colors flex items-center space-x-1.5 self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-gaming-cyan' : ''}`} />
            <span>Refresh Inventory</span>
          </button>
        </div>

        {/* Filter Pills */}
        {!loading && !error && (
          <StationFilter
            activeType={selectedType}
            onSelectType={setSelectedType}
            stations={stations}
          />
        )}

        {/* Loading Skeleton */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="rounded-2xl bg-gaming-card border border-gaming-border p-6 animate-pulse space-y-4"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-xl bg-gaming-dark" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-gaming-dark rounded w-1/3" />
                    <div className="h-5 bg-gaming-dark rounded w-2/3" />
                  </div>
                </div>
                <div className="h-16 bg-gaming-dark rounded-xl" />
                <div className="h-10 bg-gaming-dark rounded-xl" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-8 rounded-2xl bg-gaming-card border border-gaming-rose/30 text-center space-y-4 max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-xl bg-gaming-rose/15 text-gaming-rose flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">Unable to Load Stations</h3>
              <p className="text-slate-400 text-sm mt-1">{error}</p>
            </div>
            <button
              type="button"
              onClick={fetchStations}
              className="px-4 py-2 rounded-xl bg-gaming-border hover:bg-gaming-cardHover text-white text-xs font-semibold transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredStations.length === 0 && (
          <div className="p-12 rounded-2xl bg-gaming-card border border-gaming-border text-center">
            <p className="text-slate-400 text-sm">No stations found matching category "{selectedType}".</p>
          </div>
        )}

        {/* Stations Grid */}
        {!loading && !error && filteredStations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStations.map((station) => (
              <StationCard
                key={station._id || station.identifier}
                station={station}
                onViewDetails={setSpecsModalStation}
                onBook={handleBookTrigger}
              />
            ))}
          </div>
        )}
      </section>

      {/* Hardware Specs Detail Modal */}
      {specsModalStation && (
        <StationDetailModal
          station={specsModalStation}
          onClose={() => setSpecsModalStation(null)}
          onSelectForBooking={handleBookTrigger}
        />
      )}

      {/* Interactive 15-Minute Slot Picker Modal */}
      {slotPickerStation && (
        <SlotPickerModal
          station={slotPickerStation}
          isOpen={!!slotPickerStation}
          onClose={() => setSlotPickerStation(null)}
          onBookingSuccess={handleBookingCreated}
        />
      )}
    </div>
  );
}
