import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { Station } from '../../src/models/station.model.js';
import { User } from '../../src/models/user.model.js';
import { StationStatus, StationType, UserRole } from '../../src/constants/index.js';
import { seedStations } from '../../src/seeds/seedStations.js';
import { fetchCsrf } from '../helpers/csrf.js';

describe('Station APIs Integration Tests', () => {
  let adminCookie;
  let adminCsrf;

  beforeEach(async () => {
    // Clear and seed stations before each test
    await Station.deleteMany({});
    await User.deleteMany({});
    await seedStations();

    // Create and login admin user for protected routes
    const passwordHash = await User.hashPassword('AdminPass123!');
    await User.create({
      email: 'admin_test@dndgaming.com',
      passwordHash,
      fullName: 'Admin Tester',
      role: UserRole.ADMIN,
      isActive: true
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'admin_test@dndgaming.com',
      password: 'AdminPass123!'
    });
    adminCookie = loginRes.headers['set-cookie'];
    adminCsrf = await fetchCsrf(request, app, adminCookie);
  });

  describe('GET /api/stations', () => {
    it('should list all active stations', async () => {
      const res = await request(app).get('/api/stations');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(6);
      expect(res.body.data).toHaveLength(6);

      // Verify integer paise structure
      const pcStation = res.body.data.find((s) => s.identifier === 'PC-01');
      expect(pcStation).toBeDefined();
      expect(pcStation.hourlyRatePaise).toBe(12000); // Integer paise
      expect(pcStation.type).toBe(StationType.PC);
      expect(pcStation.status).toBe(StationStatus.AVAILABLE);
    });

    it('should filter stations by type (PC)', async () => {
      const res = await request(app).get('/api/stations?type=PC');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(4);
      res.body.data.forEach((station) => {
        expect(station.type).toBe(StationType.PC);
      });
    });

    it('should filter stations by type (PS5)', async () => {
      const res = await request(app).get('/api/stations?type=PS5');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      res.body.data.forEach((station) => {
        expect(station.type).toBe(StationType.PS5);
      });
    });

    it('should reject invalid station type query with 400 validation error', async () => {
      const res = await request(app).get('/api/stations?type=INVALID_CONSOLE');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should exclude deactivated stations from default public listing', async () => {
      // Deactivate PC-04
      await Station.findOneAndUpdate(
        { identifier: 'PC-04' },
        { status: StationStatus.DEACTIVATED }
      );

      const publicRes = await request(app).get('/api/stations');
      expect(publicRes.body.count).toBe(5);
      const found = publicRes.body.data.find((s) => s.identifier === 'PC-04');
      expect(found).toBeUndefined();

      // Should include when includeDeactivated=true
      const adminRes = await request(app).get('/api/stations?includeDeactivated=true');
      expect(adminRes.body.count).toBe(6);
    });
  });

  describe('GET /api/stations/:id', () => {
    it('should retrieve a station by MongoDB ObjectId', async () => {
      const pc1 = await Station.findOne({ identifier: 'PC-01' });
      const res = await request(app).get(`/api/stations/${pc1._id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.identifier).toBe('PC-01');
      expect(res.body.data.name).toBe(pc1.name);
    });

    it('should retrieve a station by identifier string (e.g. PS5-01)', async () => {
      const res = await request(app).get('/api/stations/PS5-01');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.identifier).toBe('PS5-01');
      expect(res.body.data.type).toBe(StationType.PS5);
      expect(res.body.data.hourlyRatePaise).toBe(15000);
    });

    it('should return 404 if station is not found', async () => {
      const res = await request(app).get('/api/stations/PC-999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('STATION_NOT_FOUND');
    });
  });

  describe('POST /api/stations (Creation & Validation)', () => {
    it('should create a new station with integer paise rate', async () => {
      const newStation = {
        identifier: 'VR-01',
        name: 'Meta Quest 3 Arena',
        type: StationType.VR,
        hourlyRatePaise: 20000, // ₹200.00
        description: 'Immersive wireless VR station with full tracking space.',
        specs: {
          display: '4K Infinite Display (2064x2208 per eye)',
          peripherals: 'Touch Plus Controllers, Elite Strap'
        }
      };

      const res = await request(app)
        .post('/api/stations')
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send(newStation);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.identifier).toBe('VR-01');
      expect(res.body.data.hourlyRatePaise).toBe(20000);

      // Verify in DB
      const inDb = await Station.findOne({ identifier: 'VR-01' });
      expect(inDb).toBeDefined();
    });

    it('should reject duplicate identifier with 409 Conflict', async () => {
      const duplicate = {
        identifier: 'PC-01', // Already seeded
        name: 'Another PC',
        type: StationType.PC,
        hourlyRatePaise: 12000
      };

      const res = await request(app)
        .post('/api/stations')
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send(duplicate);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('STATION_IDENTIFIER_EXISTS');
    });

    it('should reject non-integer or negative hourly rates', async () => {
      const invalid = {
        identifier: 'PC-05',
        name: 'Invalid Price PC',
        type: StationType.PC,
        hourlyRatePaise: 120.5 // Floating-point paise forbidden!
      };

      const res = await request(app)
        .post('/api/stations')
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send(invalid);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});