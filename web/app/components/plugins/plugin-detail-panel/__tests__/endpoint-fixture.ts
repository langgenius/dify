import { normalizeInstalledPluginDetail } from '@/service/use-plugins'

export const createPluginDetail = () =>
  normalizeInstalledPluginDetail({
    id: 'test-id',
    created_at: '2024-01-01',
    updated_at: '2024-01-02',
    plugin_id: 'test-plugin',
    plugin_unique_identifier: 'test-uid',
    tenant_id: 'tenant-1',
    endpoints_setups: 1,
    endpoints_active: 1,
    version: '1.0.0',
    source: 'marketplace',
    runtime_type: 'local',
    checksum: 'checksum',
    meta: {},
    declaration: {
      version: '1.0.0',
      author: 'Dify',
      name: 'Test Plugin',
      category: 'extension',
      created_at: '2024-01-01',
      icon: 'plugin.svg',
      label: { en_US: 'Test Plugin' },
      description: { en_US: 'Endpoint plugin' },
      resource: {},
      plugins: {},
      meta: {},
      endpoint: {
        settings: [
          { name: 'enabled', type: 'boolean', default: false },
          { name: 'count', type: 'text-input', default: '0' },
          { name: 'token', type: 'secret-input', default: '' },
        ],
        endpoints: [],
      },
    },
  })
