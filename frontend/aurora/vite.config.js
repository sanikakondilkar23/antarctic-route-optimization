import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // The SIC API origin. In development it is proxied (below) so the browser
  // talks to the same origin and needs no CORS preflight. For a deployed
  // frontend set VITE_SIC_API_PROXY_TARGET to the absolute backend origin, or
  // leave the proxy in place and run both behind one host.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_SIC_API_PROXY_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      open: false,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            chart: ['recharts'],
            map: ['leaflet', 'react-leaflet'],
            icons: ['lucide-react'],
          },
        },
      },
    },
  }
})
