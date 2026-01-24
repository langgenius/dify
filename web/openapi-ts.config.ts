import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './open-api/petStore.yaml',
  output: './gen',
  plugins: [
    '@hey-api/typescript',
    {
      name: 'zod',
      requests: true,
      responses: true,
      metadata: true,
      definitions: true,
      types: {
        infer: true,
      },
    },
  ],
})
