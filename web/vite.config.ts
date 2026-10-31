import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // DEV PROXY: the React app calls /api/... ; Vite forwards it to the API on
    // port 3000 and removes the "/api" part (/api/auth/me -> /auth/me).
    // WHY? The browser then thinks the page and the API are ONE website, so the
    // login cookie is sent normally and there are no CORS problems.
    // In Docker, nginx does exactly the same job (see web/nginx.conf).
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
