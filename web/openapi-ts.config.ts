import { defineConfig } from '@hey-api/openapi-ts'

import { defineConfig as defineOrpcConfig } from './plugins/hey-api-orpc/config'

export default defineConfig({
  input: './open-api/petStore.yaml',
  output: {
    indexFile: false,
    path: './gen',
  },
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
    defineOrpcConfig({
      output: 'orpc',
    }),
  ],
})
