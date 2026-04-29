import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Read shared SSL certificate (same cert used by backend HTTPS on port 3001)
const sslDir = path.resolve(__dirname, 'server/ssl')
const httpsConfig = fs.existsSync(path.join(sslDir, 'cert.pem'))
  ? {
      key: fs.readFileSync(path.join(sslDir, 'key.pem')),
      cert: fs.readFileSync(path.join(sslDir, 'cert.pem')),
    }
  : true  // fallback: let Vite generate its own cert

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    https: httpsConfig,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/ws/dashscope-tts': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/ws/dashscope-asr': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/ws/voice-pipeline': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
