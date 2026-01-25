import { defineConfig } from '@hey-api/openapi-ts'

import { defineConfig as defineOrpcConfig } from './plugins/hey-api-orpc/config'

export default defineConfig({
  input: './openapi_chat.json',
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
      // fileStrategy: 'byTags', // Uncomment to split files by tag
    }),
  ],
})
