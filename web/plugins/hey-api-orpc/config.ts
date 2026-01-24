import type { OrpcPlugin } from './types'

import { definePluginConfig } from '@hey-api/openapi-ts'

import { handler } from './plugin'

export const defaultConfig: OrpcPlugin['Config'] = {
  config: {
    baseName: 'base',
    exportFromIndex: false,
    generateRouter: true,
    output: 'orpc',
  },
  dependencies: ['@hey-api/typescript', 'zod'],
  handler,
  name: 'orpc',
}

export const defineConfig = definePluginConfig(defaultConfig)
