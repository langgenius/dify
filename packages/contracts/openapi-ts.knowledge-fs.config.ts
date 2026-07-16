import { defineConfig } from '@hey-api/openapi-ts'

const proxyPrefix = '/knowledge-fs'
const input = process.env.KNOWLEDGE_FS_OPENAPI ?? 'http://localhost:8788/openapi.json'

export default defineConfig({
  input,
  logs: {
    file: false,
  },
  output: {
    clean: true,
    entryFile: false,
    fileName: {
      suffix: '.gen',
    },
    path: 'generated/knowledge-fs',
  },
  parser: {
    filters: {
      operations: {
        include: ['GET /knowledge-fs/knowledge-spaces', 'POST /knowledge-fs/knowledge-spaces'],
      },
    },
    patch: {
      input: (spec) => {
        const paths = spec.paths as Record<string, unknown> | undefined
        if (!paths) return

        for (const [path, pathItem] of Object.entries(paths)) {
          delete paths[path]
          paths[`${proxyPrefix}${path}`] = pathItem
        }
      },
    },
  },
  plugins: [
    {
      comments: false,
      name: '@hey-api/typescript',
    },
    {
      name: 'zod',
    },
    {
      contracts: {
        strategy: 'single',
      },
      name: 'orpc',
      validator: 'zod',
    },
  ],
})
