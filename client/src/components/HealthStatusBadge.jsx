import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

export default function HealthStatusBadge() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getHealth();
      setHealth(res.data);
    } catch (err) {
      setError(err.message || 'Failed to connect to backend server');
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const isHealthy = health?.status === 'healthy';

  return (
    <div className="p-4 rounded-xl bg-gaming-card border border-gaming-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-gaming-cyan" />
          <h3 className="font-semibold text-white text-sm">System Health Monitor</h3>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="p-1 rounded hover:bg-gaming-border text-slate-400 hover:text-white transition-colors"
          title="Refresh health check"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-gaming-cyan' : ''}`} />
        </button>
      </div>

      {loading && !health && (
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-gaming-primary" />
          <span>Probing backend and database readiness...</span>
        </div>
      )}

      {error && (
        <div className="flex items-start space-x-2 text-xs text-gaming-rose bg-gaming-rose/10 p-2.5 rounded-lg border border-gaming-rose/20">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Backend Offline or Unreachable</p>
            <p className="text-slate-400 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {health && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">API Gateway:</span>
            <span className="flex items-center space-x-1 text-gaming-emerald font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Online (Uptime: {health.uptimeSeconds}s)</span>
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400">Database Engine:</span>
            <span
              className={`flex items-center space-x-1 font-medium ${
                health.services.database.status === 'healthy'
                  ? 'text-gaming-emerald'
                  : 'text-gaming-amber'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {health.services.database.readyState.toUpperCase()} (
                {health.services.database.database || 'ReplicaSet'})
              </span>
            </span>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-gaming-border text-[11px] text-slate-500">
            <span>Env: {health.environment}</span>
            <span>TZ: {health.timezone}</span>
          </div>
        </div>
      )}
    </div>
  );
}
