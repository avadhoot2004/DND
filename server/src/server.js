import app from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';

async function bootstrap() {
  try {
    // Connect to database
    await connectDB();

    // Start HTTP server
    const server = app.listen(env.PORT, () => {
      console.log(`🚀 DND Gaming Hub Server running on port ${env.PORT} [${env.NODE_ENV}]`);
      console.log(`📡 Health Check: http://localhost:${env.PORT}/api/health`);
    });

    // Graceful shutdown handling
    const handleShutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
      server.close(async () => {
        console.log('🔒 HTTP server closed');
        await disconnectDB();
        console.log('👋 Process terminated cleanly');
        process.exit(0);
      });

      // Force shutdown if taking longer than 10s
      setTimeout(() => {
        console.error('⚠️ Forcefully terminating process after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Server failed to start:', error);
    process.exit(1);
  }
}

bootstrap();
