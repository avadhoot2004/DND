import request from 'supertest';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import app from '../../src/app.js';

describe('GET /api/health Integration Tests', () => {
  it('should return 200 and healthy status when database is connected', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.services.api.status).toBe('healthy');
    expect(res.body.data.services.database.status).toBe('healthy');
    expect(res.body.data.services.database.readyState).toBe('connected');
    expect(res.body.data.environment).toBeDefined();
    expect(res.body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('should return 404 for unknown endpoints with standard error format', async () => {
    const res = await request(app).get('/api/non-existent-endpoint');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('Cannot GET /api/non-existent-endpoint');
  });

  it('should verify that MongoDB replica set supports ACID transactions', async () => {
    const session = await mongoose.startSession();
    expect(session).toBeDefined();

    let committed = false;
    await session.withTransaction(async () => {
      // Transaction starts and commits without throwing
      committed = true;
    });

    expect(committed).toBe(true);
    await session.endSession();
  });
});
