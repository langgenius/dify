import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: { environment: 'node', restoreMocks: true },
})
