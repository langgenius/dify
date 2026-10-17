import type { PluginEntity } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginDeclaration } from '@/app/components/plugins/types'
import { zPostWorkspacesCurrentPluginListInstallationsIdsResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'

export const createPluginEntity = (overrides: Partial<PluginEntity> = {}) =>
  zPostWorkspacesCurrentPluginListInstallationsIdsResponse.parse({
    plugins: [
      {
        checksum: 'checksum',
        created_at: '2026-06-01T00:00:00Z',
        declaration: {
          author: 'Dify',
          category: PluginCategoryEnum.tool,
          created_at: '2026-06-01T00:00:00Z',
          description: { en_US: 'Plugin description' },
          icon: 'icon.svg',
          label: { en_US: 'Plugin label' },
          meta: { version: '1.0.0' },
          name: 'plugin-entity',
          plugins: {},
          resource: { memory: 0 },
          version: '1.0.0',
        },
        endpoints_active: 1,
        endpoints_setups: 1,
        id: 'plugin-entity-id',
        installation_id: 'plugin-entity-id',
        meta: {},
        name: 'plugin-entity',
        plugin_id: 'langgenius/plugin-entity',
        plugin_unique_identifier: 'langgenius/plugin-entity:1.0.0@test',
        runtime_type: 'local',
        source: PluginSource.marketplace,
        tenant_id: 'tenant-id',
        updated_at: '2026-06-02T00:00:00Z',
        version: '1.0.0',
        ...overrides,
      },
    ],
  }).plugins[0]!

export const createPluginDeclarationFixture = (
  overrides: Partial<PluginDeclaration> = {},
): PluginDeclaration => ({
  plugin_unique_identifier: 'test-plugin-uid',
  version: '1.0.0',
  author: 'test-author',
  icon: 'test-icon.png',
  name: 'Test Plugin',
  category: PluginCategoryEnum.tool,
  label: { en_US: 'Test Plugin' } as PluginDeclaration['label'],
  description: { en_US: 'A test plugin' } as PluginDeclaration['description'],
  created_at: '2024-01-01T00:00:00Z',
  resource: {},
  plugins: [],
  verified: true,
  endpoint: { settings: [], endpoints: [] },
  model: null,
  tags: [],
  agent_strategy: null,
  meta: { version: '1.0.0', minimum_dify_version: '0.8.0' },
  trigger: {} as PluginDeclaration['trigger'],
  ...overrides,
})
