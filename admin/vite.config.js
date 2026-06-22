import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    // El proxy reescribe las URLs en desarrollo:
    //   fetch('/api/login')  →  http://localhost:8000/login
    //   fetch('/api/yo')     →  http://localhost:8000/yo
    //
    // Esto evita errores CORS en desarrollo, y en producción nginx
    // hace lo mismo con un proxy_pass al backend.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Redirige /uploads/* → http://localhost:8000/uploads/*
      // Así las URLs de imágenes son iguales en dev y en producción
      // (en prod, nginx las sirve directamente sin pasar por FastAPI).
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
