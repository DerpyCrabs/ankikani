import { defineConfig } from 'vitest/config'
import { effectweb } from '@effectweb/compiler/vite'

export default defineConfig({
  plugins: [effectweb()],
  test: {
    pool: 'threads',
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.ts', 'server/anki.ts'],
    },
  },
})
