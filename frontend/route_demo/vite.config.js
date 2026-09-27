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
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
