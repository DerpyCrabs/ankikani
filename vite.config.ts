import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    watch: {
      ignored: [
        '**/.git/**',
        '**/coverage/**',
        '**/dist/**',
        '**/docs/**',
        '**/server/**',
        '**/tests/**',
        '**/*.md',
        '**/tsconfig*.json',
        '**/vitest.config.*',
      ],
    },
  },
})
