import type { ToolWithProvider } from '../../types'
import type { Plugin } from '@/app/components/plugins/types'
import type { Tool } from '@/app/components/tools/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { defaultSystemFeatures } from '@/types/feature'

export const createTool = (
  name: string,
  label: string,
  description = `${label} description`,
): Tool => ({
  name,
  author: 'author',
  label: {
    en_US: label,
    zh_Hans: label,
  },
  description: {
    en_US: description,
    zh_Hans: description,
  },
  parameters: [],
  labels: [],
  output_schema: {},
})

export const createToolProvider = (
  overrides: Partial<ToolWithProvider> = {},
): ToolWithProvider => ({
  id: 'provider-1',
  name: 'provider-one',
  author: 'Provider Author',
  description: {
    en_US: 'Provider description',
    zh_Hans: 'Provider description',
  },
  icon: 'icon',
  icon_dark: 'icon-dark',
  label: {
    en_US: 'Provider One',
    zh_Hans: 'Provider One',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'plugin-1',
  tools: [createTool('tool-a', 'Tool A')],
  meta: { version: '1.0.0' } as ToolWithProvider['meta'],
  plugin_unique_identifier: 'plugin-1@1.0.0',
  ...overrides,
})

export const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'org',
  author: 'author',
  name: 'Plugin One',
  plugin_id: 'plugin-1',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'plugin-1@1.0.0',
  icon: 'icon',
  verified: true,
  label: {
    en_US: 'Plugin One',
    zh_Hans: 'Plugin One',
  },
  brief: {
    en_US: 'Plugin description',
    zh_Hans: 'Plugin description',
  },
  description: {
    en_US: 'Plugin description',
    zh_Hans: 'Plugin description',
  },
  introduction: 'Plugin introduction',
  repository: 'https://example.com/plugin',
  category: PluginCategoryEnum.tool,
  tags: [],
  badges: [],
  install_count: 0,
  endpoint: {
    settings: [],
  },
  verification: {
    authorized_category: 'community',
  },
  from: 'github',
  ...overrides,
})

export const createGlobalPublicStoreState = (enableMarketplace: boolean) => ({
  systemFeatures: {
    ...defaultSystemFeatures,
    enable_marketplace: enableMarketplace,
  },
  setSystemFeatures: vi.fn(),
})
