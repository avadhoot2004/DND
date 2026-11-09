import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { env } from './env.js';

export function createSessionMiddleware() {
  const isProduction = env.NODE_ENV === 'production';

  // Resolves the MongoClient once Mongoose connection is established
  const clientPromise = new Promise((resolve, reject) => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.getClient()) {
      return resolve(mongoose.connection.getClient());
    }
    mongoose.connection.once('open', () => {
      resolve(mongoose.connection.getClient());
    });
    mongoose.connection.once('error', (err) => {
      reject(err);
    });
  });

  const store = MongoStore.create({
    clientPromise,
    collectionName: 'sessions',
    ttl: 14 * 24 * 60 * 60, // 14 days in seconds
    autoRemove: 'native'
  });

  return session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store,
    name: 'dnd_sid',
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days in milliseconds
    }
  });
}
