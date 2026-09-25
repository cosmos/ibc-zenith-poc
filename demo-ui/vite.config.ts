import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:3200' } },
  test: { include: ['test/**/*.test.{ts,mjs}'] },
});
