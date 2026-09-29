import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React app is a pure visualization/control layer: all data loading,
// routing and rerouting happen in the backend (python -m backend.api.main).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        // Default is the documented backend port; override with
        // AURORA_API_TARGET when 8000 is already taken on this machine.
        target: process.env.AURORA_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
