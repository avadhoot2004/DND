import mongoose from 'mongoose';
import { Station } from '../models/station.model.js';
import { StationStatus, StationType } from '../constants/index.js';
import { connectDB, disconnectDB } from '../config/db.js';

export const initialStationsData = [
  {
    identifier: 'PC-01',
    name: 'Apex Predator Rig #1',
    type: StationType.PC,
    hourlyRatePaise: 12000, // ₹120.00
    description: 'Flagship esports station optimized for competitive high-framerate shooters.',
    specs: {
      cpu: 'AMD Ryzen 7 7800X3D (8C/16T, 5.0 GHz)',
      gpu: 'NVIDIA GeForce RTX 4080 16GB GDDR6X',
      ram: '32GB DDR5 6000MHz CL30',
      storage: '2TB NVMe Gen4 SSD',
      display: '27" 240Hz 0.03ms QHD OLED (LG UltraGear)',
      peripherals: 'Logitech G Pro X Superlight 2, Wooting 60HE Keyboard, HyperX Cloud III'
    },
    status: StationStatus.AVAILABLE
  },
  {
    identifier: 'PC-02',
    name: 'Apex Predator Rig #2',
    type: StationType.PC,
    hourlyRatePaise: 12000,
    description: 'Flagship esports station optimized for competitive high-framerate shooters.',
    specs: {
      cpu: 'AMD Ryzen 7 7800X3D (8C/16T, 5.0 GHz)',
      gpu: 'NVIDIA GeForce RTX 4080 16GB GDDR6X',
      ram: '32GB DDR5 6000MHz CL30',
      storage: '2TB NVMe Gen4 SSD',
      display: '27" 240Hz 0.03ms QHD OLED (LG UltraGear)',
      peripherals: 'Logitech G Pro X Superlight 2, Wooting 60HE Keyboard, HyperX Cloud III'
    },
    status: StationStatus.AVAILABLE
  },
  {
    identifier: 'PC-03',
    name: 'Velocity Titan Rig #3',
    type: StationType.PC,
    hourlyRatePaise: 12000,
    description: 'High-end gaming workstation tuned for AAA titles with full ray tracing.',
    specs: {
      cpu: 'Intel Core i7-14700K (20C/28T, 5.6 GHz)',
      gpu: 'NVIDIA GeForce RTX 4070 Ti Super 16GB',
      ram: '32GB DDR5 6000MHz',
      storage: '2TB NVMe Gen4 SSD',
      display: '27" 240Hz Fast IPS 1ms QHD',
      peripherals: 'Razer DeathAdder V3 Pro, Huntsman V3 Pro Keyboard, BlackShark V2 Pro'
    },
    status: StationStatus.AVAILABLE
  },
  {
    identifier: 'PC-04',
    name: 'Velocity Titan Rig #4',
    type: StationType.PC,
    hourlyRatePaise: 12000,
    description: 'High-end gaming workstation tuned for AAA titles with full ray tracing.',
    specs: {
      cpu: 'Intel Core i7-14700K (20C/28T, 5.6 GHz)',
      gpu: 'NVIDIA GeForce RTX 4070 Ti Super 16GB',
      ram: '32GB DDR5 6000MHz',
      storage: '2TB NVMe Gen4 SSD',
      display: '27" 240Hz Fast IPS 1ms QHD',
      peripherals: 'Razer DeathAdder V3 Pro, Huntsman V3 Pro Keyboard, BlackShark V2 Pro'
    },
    status: StationStatus.AVAILABLE
  },
  {
    identifier: 'PS5-01',
    name: 'PlayStation 5 Cinema Lounge A',
    type: StationType.PS5,
    hourlyRatePaise: 15000, // ₹150.00
    description: 'Private couch lounge featuring 4K HDR 120Hz gaming and premium Dolby Atmos sound.',
    specs: {
      cpu: 'AMD Zen 2 8-Core / RDNA 2 Custom APU',
      gpu: '10.3 TFLOPs PS5 Graphics Engine',
      ram: '16GB GDDR6 Unified Memory',
      storage: '1TB Ultra-High Speed Custom SSD',
      display: '65" LG C3 4K 120Hz OLED TV with Dolby Vision',
      peripherals: '2x DualSense Wireless Controllers, 1x DualSense Edge, Pulse 3D Headset'
    },
    status: StationStatus.AVAILABLE
  },
  {
    identifier: 'PS5-02',
    name: 'PlayStation 5 Cinema Lounge B',
    type: StationType.PS5,
    hourlyRatePaise: 15000,
    description: 'Private couch lounge featuring 4K HDR 120Hz gaming and premium Dolby Atmos sound.',
    specs: {
      cpu: 'AMD Zen 2 8-Core / RDNA 2 Custom APU',
      gpu: '10.3 TFLOPs PS5 Graphics Engine',
      ram: '16GB GDDR6 Unified Memory',
      storage: '1TB Ultra-High Speed Custom SSD',
      display: '65" LG C3 4K 120Hz OLED TV with Dolby Vision',
      peripherals: '2x DualSense Wireless Controllers, 1x DualSense Edge, Pulse 3D Headset'
    },
    status: StationStatus.AVAILABLE
  }
];

export async function seedStations() {
  console.log('🌱 Seeding initial station inventory...');
  for (const data of initialStationsData) {
    await Station.findOneAndUpdate(
      { identifier: data.identifier },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  const count = await Station.countDocuments();
  console.log(`✅ Seeded ${count} stations successfully.`);
}

// Allow direct CLI execution: node src/seeds/seedStations.js
if (process.argv[1]?.endsWith('seedStations.js')) {
  (async () => {
    try {
      await connectDB();
      await seedStations();
      await disconnectDB();
      process.exit(0);
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    }
  })();
}
