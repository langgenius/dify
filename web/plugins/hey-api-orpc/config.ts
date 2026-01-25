import type { OrpcPlugin } from './types'

import { definePluginConfig } from '@hey-api/openapi-ts'

import { handler } from './plugin'

export const defaultConfig: OrpcPlugin['Config'] = {
  config: {
    output: 'orpc',
  },
  dependencies: ['@hey-api/typescript', 'zod'],
  handler,
  name: 'orpc',
  resolveConfig: (plugin) => {
    plugin.config.output = plugin.config.output ?? 'orpc'
    plugin.config.exportFromIndex = plugin.config.exportFromIndex ?? false
    plugin.config.groupBy = plugin.config.groupBy ?? 'tag'
    plugin.config.contractNameBuilder = plugin.config.contractNameBuilder
      ?? ((id: string) => `${id}Contract`)
    plugin.config.fileStrategy = plugin.config.fileStrategy ?? 'single'
    plugin.config.filePathBuilder = plugin.config.filePathBuilder
      ?? ((tag: string) => `orpc/${tag.toLowerCase()}`)
    plugin.config.defaultTag = plugin.config.defaultTag ?? 'default'
  },
}

/**
 * Type helper for oRPC plugin, returns {@link Plugin.Config} object
 */
export const defineConfig = definePluginConfig(defaultConfig)
