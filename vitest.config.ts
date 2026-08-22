import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid({ hot: false })],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.ts', 'server/anki.ts'],
    },
  },
})
