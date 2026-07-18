import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Base path de producción: el panel se sirve desde /admin en nginx.
  // Sin esto, los assets compilados (JS/CSS) apuntarían a la raíz y
  // la página saldría en blanco al acceder desde /admin.
  base: '/admin/',

  server: {
    // El proxy reescribe las URLs en desarrollo:
    //   fetch('/api/login')  →  http://localhost:8000/login
    //   fetch('/api/yo')     →  http://localhost:8000/yo
    //
    // Esto evita errores CORS en desarrollo, y en producción nginx
    // hace lo mismo con un proxy_pass al backend.
    proxy: {
      // FastAPI ahora sirve /api/... nativamente — no hay que reescribir el path.
      // En producción, nginx hace lo mismo con proxy_pass al backend.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Redirige /uploads/* → http://localhost:8000/uploads/*
      // En prod, nginx las sirve directamente sin pasar por FastAPI.
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
