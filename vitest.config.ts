import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
