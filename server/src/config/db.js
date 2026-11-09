import mongoose from 'mongoose';
import { env } from './env.js';

let isConnected = false;

export async function connectDB(uri = env.MONGODB_URI) {
  if (isConnected) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(uri, {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    isConnected = true;
    console.log(`✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn.connection;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    throw error;
  }
}

export async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  console.log('🔌 MongoDB Disconnected');
}

export function getDatabaseHealth() {
  // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const stateCode = mongoose.connection.readyState;
  return {
    status: stateCode === 1 ? 'healthy' : 'unhealthy',
    readyState: states[stateCode] || 'unknown',
    host: mongoose.connection.host || null,
    database: mongoose.connection.name || null
  };
}
