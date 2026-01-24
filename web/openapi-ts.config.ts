import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './open-api/petStore.yaml',
  output: './gen',
  plugins: [
    '@hey-api/typescript',
    'zod',
  ],
})
