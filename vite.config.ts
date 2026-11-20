import { defineConfig } from 'vite'
import { effectweb } from '@effectweb/compiler/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [effectweb(), tailwindcss()],
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
