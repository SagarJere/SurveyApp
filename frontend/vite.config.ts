/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
// One .env at the repo root serves both the backend and the frontend.
const envDir = path.resolve(here, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  const backendPort = env.BACKEND_PORT || '8001'
  const proxyTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(here, 'src') },
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
              return 'react'
            }
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
      css: false,
    },
  }
})
