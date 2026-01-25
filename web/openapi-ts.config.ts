import { defineConfig } from '@hey-api/openapi-ts'

import { defineConfig as defineOrpcConfig } from './plugins/hey-api-orpc/config'

// Whether to split generated files by tag
const splitByTags = true

// Symbol type for the getFilePath hook (not publicly exported by hey-api)
type SymbolMeta = {
  tags?: readonly string[]
  tool?: string
  resource?: string
  pluginName?: string
}

// Get file path based on symbol metadata
function getFilePathByTag(symbol: { meta?: SymbolMeta }): string | undefined {
  const meta = symbol.meta
  if (!meta)
    return undefined

  // Get the first tag from symbol metadata
  const tag = meta.tags?.[0]?.toLowerCase()

  if (!tag)
    return undefined

  // Handle zod plugin symbols
  if (meta.tool === 'zod') {
    // Only split operation-related schemas (requests/responses), not definitions
    if (meta.resource === 'operation') {
      return `zod/${tag}`
    }
    // Keep definitions in the main zod file
    return undefined
  }

  // Handle orpc plugin symbols
  if (meta.pluginName === 'orpc') {
    return `orpc/${tag}`
  }

  return undefined
}

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
    }),
  ],
  parser: splitByTags
    ? {
        hooks: {
          symbols: {
            getFilePath: getFilePathByTag,
          },
        },
      }
    : undefined,
})
