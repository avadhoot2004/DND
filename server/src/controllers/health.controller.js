import { getDatabaseHealth } from '../config/db.js';
import { env } from '../config/env.js';

export function getHealth(req, res) {
  const dbHealth = getDatabaseHealth();
  const isHealthy = dbHealth.status === 'healthy';

  const healthData = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    timezone: env.TZ,
    services: {
      api: { status: 'healthy' },
      database: dbHealth
    }
  };

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    data: healthData
  });
}
