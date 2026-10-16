import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  plugins: [vue(), tailwindcss()],
  // GitHub Pages sert le site sous https://<pseudo>.github.io/fretboard-live/
  base: command === 'build' ? '/fretboard-live/' : '/',
  // Spotify refuse « localhost » comme URI de redirection : on sert sur l'adresse loopback
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}))
