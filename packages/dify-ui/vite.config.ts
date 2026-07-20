import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: ['@base-ui/react/form', '@base-ui/react/merge-props', '@base-ui/react/use-render'],
  },
})
