import type { PluginDetail } from '../types'
import { useQuery } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import { usePluginsWithLatestVersion } from '../hooks'
import { PluginSource } from '../types'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    plugins: {
      latestVersions: {
        queryOptions: vi.fn((options: unknown) => options),
      },
    },
  },
}))

const createPlugin = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  name: 'demo-plugin',
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'plugin-1@1.0.0',
  declaration: {} as PluginDetail['declaration'],
  installation_id: 'installation-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'plugin-1@1.0.0',
  source: PluginSource.marketplace,
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

describe('usePluginsWithLatestVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useQuery).mockReturnValue({ data: undefined } as never)
  })

  it('should disable latest-version querying when there are no marketplace plugins', () => {
    const plugins = [
      createPlugin({ plugin_id: 'github-plugin', source: PluginSource.github }),
    ]

    const { result } = renderHook(() => usePluginsWithLatestVersion(plugins))

    expect(consoleQuery.plugins.latestVersions.queryOptions).toHaveBeenCalledWith({
      input: { body: { plugin_ids: [] } },
      enabled: false,
    })
    expect(result.current).toEqual(plugins)
  })

  it('should return the original plugins when version data is unavailable', () => {
    const plugins = [createPlugin()]

    const { result } = renderHook(() => usePluginsWithLatestVersion(plugins))

    expect(result.current).toEqual(plugins)
  })

  it('should keep plugins unchanged when a plugin has no matching latest version', () => {
    const plugins = [createPlugin()]
    vi.mocked(useQuery).mockReturnValue({
      data: { versions: {} },
    } as never)

    const { result } = renderHook(() => usePluginsWithLatestVersion(plugins))

    expect(result.current).toEqual(plugins)
  })

  it('should merge latest version fields for marketplace plugins with version data', () => {
    const plugins = [
      createPlugin(),
      createPlugin({
        id: 'plugin-2',
        plugin_id: 'plugin-2',
        plugin_unique_identifier: 'plugin-2@1.0.0',
        latest_version: '1.0.0',
        latest_unique_identifier: 'plugin-2@1.0.0',
        source: PluginSource.github,
      }),
    ]
    vi.mocked(useQuery).mockReturnValue({
      data: {
        versions: {
          'plugin-1': {
            version: '1.1.0',
            unique_identifier: 'plugin-1@1.1.0',
            status: 'deleted',
            deprecated_reason: 'replaced',
            alternative_plugin_id: 'plugin-3',
          },
        },
      },
    } as never)

    const { result } = renderHook(() => usePluginsWithLatestVersion(plugins))

    expect(consoleQuery.plugins.latestVersions.queryOptions).toHaveBeenCalledWith({
      input: { body: { plugin_ids: ['plugin-1'] } },
      enabled: true,
    })
    expect(result.current).toEqual([
      expect.objectContaining({
        plugin_id: 'plugin-1',
        latest_version: '1.1.0',
        latest_unique_identifier: 'plugin-1@1.1.0',
        status: 'deleted',
        deprecated_reason: 'replaced',
        alternative_plugin_id: 'plugin-3',
      }),
      plugins[1],
    ])
  })
})
