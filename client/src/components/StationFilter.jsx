import React from 'react';
import { Monitor, Gamepad, Layers } from 'lucide-react';

export default function StationFilter({ activeType, onSelectType, stations }) {
  const pcCount = stations.filter((s) => s.type === 'PC').length;
  const ps5Count = stations.filter((s) => s.type === 'PS5').length;
  const allCount = stations.length;

  const filters = [
    { id: 'ALL', label: 'All Stations', count: allCount, icon: Layers },
    { id: 'PC', label: 'Gaming PCs', count: pcCount, icon: Monitor },
    { id: 'PS5', label: 'PlayStation 5', count: ps5Count, icon: Gamepad }
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 mb-8">
      {filters.map((f) => {
        const Icon = f.icon;
        const isActive = activeType === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelectType(f.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 border ${
              isActive
                ? 'bg-gradient-to-r from-gaming-primary to-gaming-accent text-white border-transparent shadow-glow-primary'
                : 'bg-gaming-card hover:bg-gaming-cardHover text-slate-300 border-gaming-border hover:border-slate-700'
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gaming-cyan'}`} />
            <span>{f.label}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                isActive ? 'bg-white/20 text-white' : 'bg-gaming-dark text-slate-400'
              }`}
            >
              {f.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
