import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    testTimeout: 300000,
    hookTimeout: 300000,
    fileParallelism: false
  }
});
