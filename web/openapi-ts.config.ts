import type { UserConfig } from '@hey-api/openapi-ts'
import { defineConfig } from '@hey-api/openapi-ts'

import { defineConfig as defineOrpcConfig } from './plugins/hey-api-orpc/config'

// Symbol type for the getFilePath hook (not publicly exported by hey-api)
type SymbolMeta = Record<string, unknown> & {
  tags?: readonly string[]
  tool?: string
  resource?: string
  pluginName?: string
  path?: readonly (string | number)[]
}

// Extract API path segment from OpenAPI path array
// e.g., ["paths", "/chat-messages", "post"] → "chat-messages"
// e.g., ["paths", "/files/upload", "post"] → "files"
function getApiSegment(path: readonly (string | number)[] | undefined): string | undefined {
  if (!path || path[0] !== 'paths')
    return undefined
  const apiPath = path[1] // e.g., "/chat-messages" or "/files/upload"
  if (typeof apiPath !== 'string')
    return undefined
  // Get first segment after leading slash
  return apiPath.split('/').filter(Boolean)[0]
}

// Extract schema name prefix from path array
// e.g., ["components", "schemas", "ChatRequest"] → "chat"
// e.g., ["components", "schemas", "StreamEventBase"] → "stream"
// e.g., ["components", "schemas", "ErrorResponse"] → "error"
function getSchemaPrefix(path: readonly (string | number)[] | undefined): string | undefined {
  if (!path || path[0] !== 'components' || path[1] !== 'schemas')
    return undefined
  const schemaName = path[2]
  if (typeof schemaName !== 'string')
    return undefined
  // Split PascalCase into words and take the first word
  // e.g., "ChatRequest" → ["Chat", "Request"] → "chat"
  const match = schemaName.match(/^[A-Z][a-z]*/)
  return match?.[0]?.toLowerCase()
}

// Get file path based on symbol metadata (mixed strategy)
function getFilePath(symbol: { meta?: SymbolMeta }): string | undefined {
  const meta = symbol.meta
  if (!meta)
    return undefined

  // Handle typescript plugin symbols
  if (meta.tool === 'typescript') {
    if (meta.resource === 'definition') {
      const prefix = getSchemaPrefix(meta.path)
      return `types/models/${prefix ?? 'common'}`
    }
    if (meta.resource === 'operation') {
      const segment = getApiSegment(meta.path)
      return `types/api/${segment ?? 'common'}`
    }
    return 'types/common'
  }

  // Handle zod plugin symbols
  if (meta.tool === 'zod') {
    if (meta.resource === 'definition') {
      const prefix = getSchemaPrefix(meta.path)
      return `zod/models/${prefix ?? 'common'}`
    }
    if (meta.resource === 'operation') {
      const segment = getApiSegment(meta.path)
      return `zod/api/${segment ?? 'common'}`
    }
    return 'zod/common'
  }

  // Handle orpc plugin symbols
  if (meta.pluginName === 'orpc') {
    if (meta.resource === 'router') {
      return 'orpc/router'
    }
    if (meta.resource === 'operation') {
      const segment = getApiSegment(meta.path)
      return `orpc/api/${segment ?? 'common'}`
    }
    return 'orpc/common'
  }

  return undefined
}

export default defineConfig({
  input: './openapi_chat.json',
  output: {
    indexFile: false,
    path: './gen',
    fileName: {
      suffix: null,
    },
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
  parser: {
    hooks: {
      symbols: {
        getFilePath,
      },
    },
  },
} satisfies UserConfig)
