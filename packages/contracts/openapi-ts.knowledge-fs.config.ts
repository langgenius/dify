import { $, defineConfig } from '@hey-api/openapi-ts'

const input = process.env.KNOWLEDGE_FS_OPENAPI
const outputPath = process.env.KNOWLEDGE_FS_OUTPUT ?? 'generated/knowledge-fs'

if (!input) throw new Error('KNOWLEDGE_FS_OPENAPI must point to the filtered pinned export')

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
    path: outputPath,
  },
  parser: {
    patch: {
      input: (spec) => {
        const paths = spec.paths as Record<string, unknown> | undefined
        if (!paths) return

        for (const [path, pathItem] of Object.entries(paths)) {
          delete paths[path]
          paths[`/knowledge-fs${path}`] = pathItem
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
      '~resolvers': {
        string: (ctx) => {
          if (ctx.schema.format === 'binary')
            return $(ctx.symbols.z)
              .attr('custom')
              .call()
              .generic($.type.or($.type('Blob'), $.type('File')))

          return undefined
        },
      },
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
