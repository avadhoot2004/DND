import React from 'react';
import { X, Cpu, Monitor, HardDrive, Gamepad2, Headphones, Sparkles, CheckCircle2 } from 'lucide-react';
import { formatPaiseToRupees } from '../utils/formatters';

export default function StationDetailModal({ station, onClose, onSelectForBooking }) {
  if (!station) return null;

  const specsList = [
    { label: 'Processor (CPU)', value: station.specs?.cpu, icon: Cpu },
    { label: 'Graphics (GPU)', value: station.specs?.gpu, icon: Sparkles },
    { label: 'Memory (RAM)', value: station.specs?.ram, icon: HardDrive },
    { label: 'Storage', value: station.specs?.storage, icon: HardDrive },
    { label: 'Display / Screen', value: station.specs?.display, icon: Monitor },
    { label: 'Peripherals & Audio', value: station.specs?.peripherals, icon: Headphones }
  ].filter((item) => Boolean(item.value));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-gaming-card border border-gaming-border rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gaming-border flex items-start justify-between bg-gaming-card/90">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gaming-dark border border-gaming-border flex items-center justify-center text-gaming-cyan shadow-glow-cyan">
              <Gamepad2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-gaming-primary/20 text-gaming-accent border border-gaming-primary/30">
                  {station.identifier}
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-semibold bg-gaming-emerald/15 text-gaming-emerald border border-gaming-emerald/30">
                  {station.status}
                </span>
              </div>
              <h3 className="font-display text-xl font-bold text-white mt-1">{station.name}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-gaming-border transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Rate Banner */}
          <div className="p-4 rounded-xl bg-gaming-dark border border-gaming-border flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Configured Hourly Rate</span>
              <span className="font-display text-2xl font-extrabold text-white">
                {formatPaiseToRupees(station.hourlyRatePaise)}{' '}
                <span className="text-sm font-normal text-slate-400">/ hour</span>
              </span>
            </div>
            <div className="text-right text-xs text-slate-400">
              <span className="text-gaming-cyan font-medium block">15-Minute Flexible Units</span>
              <span>Billed per active interval</span>
            </div>
          </div>

          {/* Description */}
          {station.description && (
            <div>
              <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">Overview</h4>
              <p className="text-sm text-slate-300 leading-relaxed bg-gaming-dark/40 p-3.5 rounded-xl border border-gaming-border/60">
                {station.description}
              </p>
            </div>
          )}

          {/* Specifications Table */}
          <div>
            <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-3 flex items-center space-x-1.5">
              <Cpu className="w-4 h-4 text-gaming-cyan" />
              <span>Hardware Specifications</span>
            </h4>
            <div className="grid grid-cols-1 gap-2.5">
              {specsList.map((spec, idx) => {
                const Icon = spec.icon;
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-gaming-dark border border-gaming-border/80 flex items-start space-x-3"
                  >
                    <div className="p-1.5 rounded-lg bg-gaming-card border border-gaming-border text-gaming-accent flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                        {spec.label}
                      </span>
                      <span className="text-xs font-medium text-slate-200 mt-0.5 block">
                        {spec.value}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gaming-border bg-gaming-card/90 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-gaming-border transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              if (onSelectForBooking) onSelectForBooking(station);
            }}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-gaming-primary to-gaming-accent hover:opacity-95 shadow-glow-primary transition-all flex items-center space-x-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Select This Station</span>
          </button>
        </div>
      </div>
    </div>
  );
}
