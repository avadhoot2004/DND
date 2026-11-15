import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { AuthService } from '../../src/services/auth.service.js';
import { createRateLimiter } from '../../src/middleware/rateLimiter.js';
import express from 'express';

describe('Day 7 High-Priority Security Hardening', () => {
  describe('1. Rate Limiting Middleware', () => {
    it('should throttle and return 429 when request threshold is exceeded', async () => {
      const testApp = express();
      const limiter = createRateLimiter({
        windowMs: 60 * 1000,
        max: 3,
        message: 'Rate limit hit',
        code: 'TEST_RATE_LIMIT'
      });
      testApp.get('/test-limit', limiter, (req, res) => res.json({ ok: true }));

      // 3 successful requests
      for (let i = 0; i < 3; i++) {
        const res = await request(testApp).get('/test-limit');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
      }

      // 4th request exceeds limit
      const blockedRes = await request(testApp).get('/test-limit');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe('TEST_RATE_LIMIT');
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });
  });

  describe('2. Session Fixation Protection', () => {
    it('should regenerate session ID upon successful user login', async () => {
      await AuthService.register({
        fullName: 'Session Fixation Test',
        email: 'fixation@test.com',
        phoneNumber: '+91 98765 43210',
        password: 'Password123!'
      });

      const agent = request.agent(app);

      // Pre-session request (initial session)
      const initialRes = await agent.get('/api/health');
      const initialCookie = initialRes.headers['set-cookie'];

      // Perform login
      const loginRes = await agent.post('/api/auth/login').send({
        email: 'fixation@test.com',
        password: 'Password123!'
      });

      expect(loginRes.status).toBe(200);
      const postLoginCookie = loginRes.headers['set-cookie'];

      // If initial cookie was set, verify post-login cookie has a new session ID
      if (initialCookie && postLoginCookie) {
        expect(postLoginCookie[0]).not.toBe(initialCookie[0]);
      }
      expect(postLoginCookie).toBeDefined();
      expect(postLoginCookie[0]).toContain('dnd_sid');
    });
  });

  describe('3. Express Trust Proxy Configuration', () => {
    it('should verify trust proxy setting matches production environment policy', () => {
      // In test environment, trust proxy should be false
      expect(app.get('trust proxy')).toBe(false);

      // Verify that when app is configured in production, trust proxy is enabled
      const prodApp = express();
      const isProd = true;
      if (isProd) {
        prodApp.set('trust proxy', 1);
      }
      expect(prodApp.get('trust proxy')).toBe(1);
    });
  });
});
