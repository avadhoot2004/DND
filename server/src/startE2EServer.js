import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from './app.js';
import { Station } from './models/station.model.js';
import { User } from './models/user.model.js';
import { Booking } from './models/booking.model.js';
import { ReservationSlot } from './models/reservationSlot.model.js';
import { PaymentTransaction } from './models/paymentTransaction.model.js';
import {
  StationType,
  StationStatus,
  UserRole
} from './constants/index.js';

let replSet = null;
let server = null;

async function start() {
  try {
    const customUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
    let uri;

    if (customUri) {
      console.log(`[E2E/Load-Backend] Using specified database URI: ${customUri}`);
      uri = customUri;
    } else {
      console.log('[E2E/Load-Backend] Starting in-memory MongoDB replica set rs0...');
      replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' }
      });
      uri = replSet.getUri();
      console.log(`[E2E/Load-Backend] In-memory Replica Set started: ${uri}`);
    }

    await mongoose.connect(uri);
    const dbName = mongoose.connection.name;
    console.log(`[E2E/Load-Backend] Mongoose connected successfully to database: '${dbName}'.`);

    // Strict Database Safety Check
    if (customUri) {
      if (dbName !== 'dnd_gaming_k6') {
        console.error(
          `❌ [CRITICAL SAFETY ABORT] Connected database is '${dbName}'. ` +
          `The load-testing server is strictly restricted to 'dnd_gaming_k6'. ` +
          `Refusing to perform cleanup or run on any other database.`
        );
        process.exit(1);
      }
    } else {
      // In-memory safety guard: must never point to the development database
      if (dbName === 'dnd_gaming_hub') {
        console.error(
          `❌ [CRITICAL SAFETY ABORT] Connected database is 'dnd_gaming_hub'. ` +
          `Aborting startup immediately to protect the development database.`
        );
        process.exit(1);
      }
    }

    // Initialize model indexes
    await Promise.all([
      Station.init(),
      User.init(),
      Booking.init(),
      ReservationSlot.init(),
      PaymentTransaction.init()
    ]);

    // Clear only test data from the isolated test database
    console.log(`[E2E/Load-Backend] Cleaning test database '${dbName}'...`);
    await Promise.all([
      Booking.deleteMany({}),
      ReservationSlot.deleteMany({}),
      PaymentTransaction.deleteMany({}),
      Station.deleteMany({}),
      User.deleteMany({})
    ]);

    // Seed Stations
    const stations = [
      {
        identifier: 'PC-01',
        name: 'Liquid-Cooled Titan Rig #1',
        type: StationType.PC,
        hourlyRatePaise: 15000,
        description: 'RTX 4080 • i9-14900K • 240Hz OLED Display',
        status: StationStatus.AVAILABLE,
        specs: {
          cpu: 'Intel Core i9-14900K',
          gpu: 'NVIDIA GeForce RTX 4080 16GB',
          ram: '32GB DDR5 6000MHz',
          peripherals: 'Wooting 60HE, Logitech G Pro X Superlight',
          display: '27" 1440p 240Hz QD-OLED'
        }
      },
      {
        identifier: 'PC-02',
        name: 'Cyberpunk Battle Rig #2',
        type: StationType.PC,
        hourlyRatePaise: 15000,
        description: 'RTX 4080 • Ryzen 7 7800X3D • 240Hz Display',
        status: StationStatus.AVAILABLE,
        specs: {
          cpu: 'AMD Ryzen 7 7800X3D',
          gpu: 'NVIDIA GeForce RTX 4080 16GB',
          ram: '32GB DDR5 6000MHz',
          peripherals: 'Razer Huntsman V3 Pro, DeathAdder V3 Pro',
          display: '27" 1440p 240Hz OLED'
        }
      },
      {
        identifier: 'PS5-01',
        name: 'PlayStation 5 OLED Suite #1',
        type: StationType.PS5,
        hourlyRatePaise: 12000,
        description: 'PS5 • 65" LG G3 4K 120Hz OLED • DualSense Edge',
        status: StationStatus.AVAILABLE,
        specs: {
          cpu: 'AMD Zen 2 8-core',
          gpu: 'Custom RDNA 2 (10.28 TFLOPs)',
          ram: '16GB GDDR6',
          peripherals: '2x DualSense Edge Wireless Controllers',
          display: '65" LG G3 4K 120Hz OLED TV'
        }
      },
      {
        identifier: 'PS5-02',
        name: 'PlayStation 5 Pro Lounge #2',
        type: StationType.PS5,
        hourlyRatePaise: 12000,
        description: 'PS5 • 55" 4K 120Hz OLED • Recliner Seating',
        status: StationStatus.AVAILABLE,
        specs: {
          cpu: 'AMD Zen 2 8-core',
          gpu: 'Custom RDNA 2 (10.28 TFLOPs)',
          ram: '16GB GDDR6',
          peripherals: '2x DualSense Wireless Controllers',
          display: '55" Samsung S90C 4K 120Hz OLED'
        }
      }
    ];

    await Station.insertMany(stations);
    console.log(`[E2E/Load-Backend] Seeded ${stations.length} stations.`);

    // Seed Dedicated Test Accounts (ADMIN, STAFF, CUSTOMER)
    const adminHash = await User.hashPassword('AdminPass123!');
    await User.create({
      email: 'admin@dndgaming.com',
      passwordHash: adminHash,
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      isActive: true
    });

    const staffHash = await User.hashPassword('StaffPass123!');
    await User.create({
      email: 'staff@dndgaming.com',
      passwordHash: staffHash,
      fullName: 'Lounge Staff Officer',
      role: UserRole.STAFF,
      isActive: true
    });

    const custHash = await User.hashPassword('CustomerPass123!');
    await User.create({
      email: 'pro_gamer@dndgaming.com',
      passwordHash: custHash,
      fullName: 'Pro Gamer Customer',
      role: UserRole.CUSTOMER,
      isActive: true
    });

    console.log('[E2E/Load-Backend] Seeded ADMIN, STAFF, and CUSTOMER accounts.');

    // Start Express HTTP Server on specified port
    server = app.listen(port, () => {
      console.log(`🚀 [E2E/Load-Backend] Running on http://localhost:${port}`);
      console.log(`📡 Health Check: http://localhost:${port}/api/health`);
    });

    const shutdown = async () => {
      console.log('\n[E2E/Load-Backend] Gracefully shutting down...');
      if (server) {
        await new Promise((res) => server.close(res));
      }
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      if (replSet) {
        await replSet.stop();
      }
      console.log('[E2E/Load-Backend] Teardown complete.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[E2E/Load-Backend] Failed to start:', err);
    process.exit(1);
  }
}

start();
