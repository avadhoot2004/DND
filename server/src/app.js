import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import stationRoutes from './routes/station.routes.js';
import authRoutes from './routes/auth.routes.js';
import availabilityRoutes from './routes/availability.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import { createSessionMiddleware } from './config/session.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

// Security headers
app.use(helmet());

// Cross-Origin Resource Sharing (explicit origin with credentials)
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-mock-signature']
  })
);

// Body parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Session management (backed by MongoDB connect-mongo)
app.use(createSessionMiddleware());

// Logging (disabled in test environment)
if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);


// Fallback 404 and global error handling
app.use(notFound);
app.use(errorHandler);

export default app;
