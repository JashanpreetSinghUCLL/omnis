import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    proxy: {
      // REST + SSE
      '/v1': {
        target: API_TARGET,
        changeOrigin: true,
        // Disable response buffering so SSE tokens arrive immediately
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            if (req.url?.includes('/ask')) {
              // SSE: tell the upstream not to buffer
              _proxyReq.setHeader('X-Accel-Buffering', 'no')
            }
          })
        },
      },
      // WebSocket — ingest progress
      '/v1/ingest': {
        target: API_TARGET.replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
      },
      // Legacy health + query
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
