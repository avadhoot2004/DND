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

let replSet;
let server;

async function start() {
  try {
    console.log('[E2E-Backend] Starting in-memory MongoDB replica set rs0...');
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' }
    });
    const uri = replSet.getUri();
    console.log(`[E2E-Backend] Replica Set started: ${uri}`);

    await mongoose.connect(uri);
    console.log('[E2E-Backend] Mongoose connected successfully.');

    // Initialize indexes
    await Promise.all([
      Station.init(),
      User.init(),
      Booking.init(),
      ReservationSlot.init(),
      PaymentTransaction.init()
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

    await Station.deleteMany({});
    await Station.insertMany(stations);
    console.log(`[E2E-Backend] Seeded ${stations.length} stations.`);

    // Seed Dedicated Test Accounts (ADMIN, STAFF, CUSTOMER)
    await User.deleteMany({});

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

    console.log('[E2E-Backend] Seeded ADMIN, STAFF, and CUSTOMER accounts.');

    // Start Express HTTP Server on Port 5000
    server = app.listen(5000, () => {
      console.log('🚀 [E2E-Backend] Running on http://localhost:5000');
    });

    const shutdown = async () => {
      console.log('\n[E2E-Backend] Gracefully shutting down...');
      if (server) {
        await new Promise((res) => server.close(res));
      }
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      if (replSet) {
        await replSet.stop();
      }
      console.log('[E2E-Backend] Teardown complete.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[E2E-Backend] Failed to start:', err);
    process.exit(1);
  }
}

start();

