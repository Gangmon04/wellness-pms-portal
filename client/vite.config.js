import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : '/app/',
  plugins: [react()],
  server: {
    port: 7002,
    open: false,
    fs: {
      allow: ['..']
    },
    proxy: {
      '/server': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  }
}))
