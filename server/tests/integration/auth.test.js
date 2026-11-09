import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { User } from '../../src/models/user.model.js';
import { UserRole, StationType } from '../../src/constants/index.js';

describe('Authentication & Authorization Integration Tests', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  const validCustomer = {
    email: 'gamer@example.com',
    password: 'GamerPassword123!',
    fullName: 'Arjun Verma',
    phoneNumber: '+91 99887 76655'
  };

  describe('POST /api/auth/register', () => {
    it('should register a new customer and set session cookie', async () => {
      const res = await request(app).post('/api/auth/register').send(validCustomer);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(validCustomer.email);
      expect(res.body.data.user.fullName).toBe(validCustomer.fullName);
      expect(res.body.data.user.role).toBe(UserRole.CUSTOMER);
      expect(res.body.data.user.passwordHash).toBeUndefined(); // Must never be exposed

      // Verify session cookie was set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('dnd_sid');

      // Verify user persisted in database
      const inDb = await User.findOne({ email: validCustomer.email });
      expect(inDb).toBeDefined();
      expect(await inDb.comparePassword(validCustomer.password)).toBe(true);
    });

    it('should reject registration if email is already taken', async () => {
      await request(app).post('/api/auth/register').send(validCustomer);
      const duplicateRes = await request(app).post('/api/auth/register').send(validCustomer);

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.success).toBe(false);
      expect(duplicateRes.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('should reject weak password violating criteria', async () => {
      const weak = { ...validCustomer, password: 'weak' };
      const res = await request(app).post('/api/auth/register').send(weak);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should prevent privilege escalation if client attempts to send role: ADMIN', async () => {
      const exploit = {
        ...validCustomer,
        email: 'hacker@example.com',
        role: UserRole.ADMIN
      };

      const res = await request(app).post('/api/auth/register').send(exploit);

      expect(res.status).toBe(201);
      // Strictly assigned CUSTOMER role
      expect(res.body.data.user.role).toBe(UserRole.CUSTOMER);

      const inDb = await User.findOne({ email: 'hacker@example.com' });
      expect(inDb.role).toBe(UserRole.CUSTOMER);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(validCustomer);
    });

    it('should successfully log in with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: validCustomer.email,
        password: validCustomer.password
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(validCustomer.email);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('dnd_sid');
    });

    it('should reject login with incorrect password', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: validCustomer.email,
        password: 'WrongPassword999!'
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject login for deactivated accounts', async () => {
      await User.findOneAndUpdate(
        { email: validCustomer.email },
        { isActive: false }
      );

      const res = await request(app).post('/api/auth/login').send({
        email: validCustomer.email,
        password: validCustomer.password
      });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    });
  });

  describe('GET /api/auth/me & Session Verification', () => {
    it('should return 401 when accessing /me without an active session', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return user profile when authenticated with session cookie', async () => {
      // 1. Register and capture cookie
      const regRes = await request(app).post('/api/auth/register').send(validCustomer);
      const cookie = regRes.headers['set-cookie'];

      // 2. Query /me with session cookie
      const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.user.email).toBe(validCustomer.email);
      expect(meRes.body.data.user.fullName).toBe(validCustomer.fullName);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should destroy the session and invalidate subsequent requests', async () => {
      // 1. Log in
      await request(app).post('/api/auth/register').send(validCustomer);
      const loginRes = await request(app).post('/api/auth/login').send({
        email: validCustomer.email,
        password: validCustomer.password
      });
      const cookie = loginRes.headers['set-cookie'];

      // 2. Log out
      const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
      expect(logoutRes.status).toBe(200);

      // 3. Verify /me now returns 401 Unauthorized
      const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(meRes.status).toBe(401);
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('should block unauthenticated requests to protected admin endpoint', async () => {
      const res = await request(app).post('/api/stations').send({
        identifier: 'PC-99',
        name: 'Unauthorized PC',
        type: StationType.PC,
        hourlyRatePaise: 12000
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should block customer role from creating a station (403 Forbidden)', async () => {
      // Register normal customer
      const regRes = await request(app).post('/api/auth/register').send(validCustomer);
      const customerCookie = regRes.headers['set-cookie'];

      const res = await request(app)
        .post('/api/stations')
        .set('Cookie', customerCookie)
        .send({
          identifier: 'PC-99',
          name: 'Customer Attempted PC',
          type: StationType.PC,
          hourlyRatePaise: 12000
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow admin role to create a station', async () => {
      // Create admin user directly in DB
      const adminPasswordHash = await User.hashPassword('AdminSecured123!');
      await User.create({
        email: 'boss@dndgaming.com',
        passwordHash: adminPasswordHash,
        fullName: 'Lounge Owner',
        role: UserRole.ADMIN,
        isActive: true
      });

      // Log in as admin
      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'boss@dndgaming.com',
        password: 'AdminSecured123!'
      });
      const adminCookie = loginRes.headers['set-cookie'];

      // Create station with admin cookie
      const res = await request(app)
        .post('/api/stations')
        .set('Cookie', adminCookie)
        .send({
          identifier: 'PC-99',
          name: 'Authorized Admin PC',
          type: StationType.PC,
          hourlyRatePaise: 12000
        });

      expect(res.status).toBe(201);
      expect(res.body.data.identifier).toBe('PC-99');
    });
  });
});
