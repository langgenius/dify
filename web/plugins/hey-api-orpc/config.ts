import type { OrpcPlugin } from './types'

import { definePluginConfig } from '@hey-api/openapi-ts'

import { handler } from './plugin'

export const defaultConfig: OrpcPlugin['Config'] = {
  config: {
    contractNameBuilder: (id: string) => `${id}Contract`,
    defaultTag: 'default',
    exportFromIndex: false,
    output: 'orpc',
  },
  dependencies: ['@hey-api/typescript', 'zod'],
  handler,
  name: 'orpc',
  resolveConfig: (plugin, _context) => {
    plugin.config.output ??= 'orpc'
    plugin.config.exportFromIndex ??= false
    plugin.config.contractNameBuilder ??= (id: string) => `${id}Contract`
    plugin.config.defaultTag ??= 'default'
  },
  tags: ['client'],
}

/**
 * Type helper for oRPC plugin, returns {@link Plugin.Config} object
 */
export const defineConfig = definePluginConfig(defaultConfig)
