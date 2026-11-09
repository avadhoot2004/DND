import React from 'react';
import { Monitor, Gamepad, Info, Calendar } from 'lucide-react';
import { formatPaiseToRupees } from '../utils/formatters';

export default function StationCard({ station, onViewDetails, onBook }) {
  const isPC = station.type === 'PC';
  const Icon = isPC ? Monitor : Gamepad;

  return (
    <div className="group relative rounded-2xl bg-gaming-card border border-gaming-border hover:border-gaming-cyan/50 transition-all duration-300 p-6 flex flex-col justify-between hover:shadow-glow-cyan/15 hover:-translate-y-0.5">
      <div>
        {/* Card Header: Identifier, Type & Status */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gaming-dark border border-gaming-border flex items-center justify-center text-gaming-cyan group-hover:scale-105 transition-transform shadow-inner">
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-gaming-primary/15 text-gaming-accent border border-gaming-primary/25">
                  {station.identifier}
                </span>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  {station.type}
                </span>
              </div>
              <h3 className="font-display font-bold text-lg text-white mt-1 group-hover:text-gaming-cyan transition-colors">
                {station.name}
              </h3>
            </div>
          </div>

          <div className="text-right">
            <span className="font-display text-xl font-extrabold text-white block">
              {formatPaiseToRupees(station.hourlyRatePaise)}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">per hour</span>
          </div>
        </div>

        {/* Short specs preview pill */}
        <div className="p-3 rounded-xl bg-gaming-dark/70 border border-gaming-border/60 text-xs text-slate-300 mb-4 space-y-1">
          {station.specs?.gpu && (
            <div className="flex items-center space-x-1.5 truncate">
              <span className="text-slate-500 font-medium flex-shrink-0">GPU:</span>
              <span className="text-slate-200 truncate">{station.specs.gpu}</span>
            </div>
          )}
          {station.specs?.display && (
            <div className="flex items-center space-x-1.5 truncate">
              <span className="text-slate-500 font-medium flex-shrink-0">Display:</span>
              <span className="text-slate-200 truncate">{station.specs.display}</span>
            </div>
          )}
        </div>

        {/* Description snippet */}
        {station.description && (
          <p className="text-xs text-slate-400 line-clamp-2 mb-6">
            {station.description}
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gaming-border/60">
        <button
          type="button"
          onClick={() => onViewDetails(station)}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-gaming-dark hover:bg-gaming-cardHover border border-gaming-border transition-colors flex items-center justify-center space-x-1.5"
        >
          <Info className="w-3.5 h-3.5 text-gaming-accent" />
          <span>Full Specs</span>
        </button>

        <button
          type="button"
          onClick={() => onBook(station)}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-gaming-primary to-gaming-accent hover:opacity-95 shadow-glow-primary transition-all flex items-center justify-center space-x-1.5"
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Select Slots</span>
        </button>
      </div>
    </div>
  );
}
