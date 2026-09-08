import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset URLs so the built deck works from any path, including a plain folder.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    modulePreload: { polyfill: false },
  },
})
