import type { Dependency, PackageDependency, Plugin, VersionInfo } from '@/app/components/plugins/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { pluginInstallLimit } from '@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useFetchPluginsInMarketPlaceByInfo } from '@/service/use-plugins'
import { defaultSystemFeatures } from '@/types/feature'
import { getPluginKey, useInstallMultiState } from '../use-install-multi-state'

const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockUseFetchPluginsInMarketPlaceByInfo = vi.mocked(useFetchPluginsInMarketPlaceByInfo)
const mockUseCheckInstalled = vi.mocked(useCheckInstalled)
const mockPluginInstallLimit = vi.mocked(pluginInstallLimit)

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByInfo: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit', () => ({
  pluginInstallLimit: vi.fn(),
}))

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'tool',
  org: 'plugin-org',
  author: 'plugin-author',
  name: 'plugin-name',
  plugin_id: 'plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'pkg-id',
  icon: 'icon.png',
  verified: false,
  label: { 'en-US': 'Plugin Name' } as Plugin['label'],
  brief: { 'en-US': 'Plugin brief' } as Plugin['brief'],
  description: { 'en-US': 'Plugin description' } as Plugin['description'],
  introduction: '',
  repository: '',
  category: 'tool' as Plugin['category'],
  install_count: 0,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'langgenius' },
  from: 'marketplace',
  ...overrides,
})

const createPackageDependency = (overrides: Partial<PackageDependency> = {}): PackageDependency => ({
  type: 'package',
  value: {
    unique_identifier: 'package-plugin-uid',
    manifest: {
      plugin_unique_identifier: 'package-plugin-uid',
      version: '1.0.0',
      author: 'package-org',
      name: 'Package Plugin',
    } as PackageDependency['value']['manifest'],
  },
  ...overrides,
})

describe('useInstallMultiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGlobalPublicStore.mockImplementation((selector) => {
      return selector({
        systemFeatures: defaultSystemFeatures,
        setSystemFeatures: vi.fn(),
      })
    })
    mockUseFetchPluginsInMarketPlaceByInfo.mockReturnValue({
      isLoading: false,
      data: null,
      error: null,
    } as unknown as ReturnType<typeof useFetchPluginsInMarketPlaceByInfo>)
    mockUseCheckInstalled.mockReturnValue({
      installedInfo: {},
      isLoading: false,
      error: null,
    } as ReturnType<typeof useCheckInstalled>)
    mockPluginInstallLimit.mockReturnValue({ canInstall: true })
  })

  // Covers the exported plugin key helper.
  describe('getPluginKey', () => {
    it('should derive keys from org/name and fall back to author/name', () => {
      expect(getPluginKey(createPlugin({ org: 'langgenius', name: 'search' }))).toBe('langgenius/search')
      expect(getPluginKey(createPlugin({ org: '', author: 'author', name: 'plugin' }))).toBe('author/plugin')
    })
  })

  // Covers package + marketplace aggregation and parent notification when loading completes.
  describe('aggregation', () => {
    it('should merge package and marketplace plugins and notify when all install info is ready', async () => {
      const onLoadedAllPlugin = vi.fn()
      const installedInfo: Record<string, VersionInfo> = {
        'package-org/Package Plugin': {
          installedId: 'installed-id',
          installedVersion: '0.9.0',
          uniqueIdentifier: 'package-plugin-uid',
        },
      }
      mockUseFetchPluginsInMarketPlaceByInfo.mockReturnValue({
        isLoading: false,
        data: {
          data: {
            list: [
              {
                plugin: createPlugin({
                  plugin_id: 'lang/plugin-1',
                  org: 'lang',
                  name: 'plugin-1',
                }),
              },
            ],
          },
        },
        error: null,
      } as unknown as ReturnType<typeof useFetchPluginsInMarketPlaceByInfo>)
      mockUseCheckInstalled.mockReturnValue({
        installedInfo,
        isLoading: false,
        error: null,
      } as ReturnType<typeof useCheckInstalled>)

      const { result } = renderHook(() => useInstallMultiState({
        allPlugins: [
          createPackageDependency(),
          {
            type: 'marketplace',
            value: {
              marketplace_plugin_unique_identifier: 'lang/plugin-1:1.0.0',
            },
          },
        ] as Dependency[],
        selectedPlugins: [],
        onSelect: vi.fn(),
        onLoadedAllPlugin,
      }))

      await waitFor(() => expect(onLoadedAllPlugin).toHaveBeenCalledWith(installedInfo))
      expect(result.current.plugins[0]).toEqual(expect.objectContaining({
        plugin_id: 'package-plugin-uid',
        name: 'Package Plugin',
      }))
      expect(result.current.plugins[1]).toEqual(expect.objectContaining({
        plugin_id: 'lang/plugin-1',
        name: 'plugin-1',
        from: 'marketplace',
      }))
      expect(result.current.errorIndexes).toEqual([])
    })
  })

  // Covers github callbacks, selection bookkeeping, and installability filtering.
  describe('github state', () => {
    it('should track github payloads, errors, and installable selections', () => {
      const onSelect = vi.fn()
      mockPluginInstallLimit.mockImplementation(plugin => ({
        canInstall: plugin?.name !== 'Blocked Plugin',
      }))

      const selectedPackage = createPlugin({
        plugin_id: 'package-plugin-uid',
        name: 'Package Plugin',
      })

      const { result } = renderHook(() => useInstallMultiState({
        allPlugins: [
          {
            type: 'github',
            value: {
              repo: 'org/repo',
              version: '1.0.0',
              package: 'tool',
            },
          },
          createPackageDependency(),
        ] as Dependency[],
        selectedPlugins: [selectedPackage],
        onSelect,
        onLoadedAllPlugin: vi.fn(),
      }))

      act(() => {
        result.current.handleGitHubPluginFetched(0)(createPlugin({
          plugin_id: 'github-plugin-id',
          org: 'github-org',
          name: 'Blocked Plugin',
          from: 'github',
        }))
      })

      act(() => {
        result.current.handleGitHubPluginFetchError(0)()
      })

      act(() => {
        result.current.handleSelect(0)()
      })

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
        plugin_id: 'github-plugin-id',
      }), 0, 1)
      expect(result.current.isPluginSelected(1)).toBe(true)
      expect(result.current.errorIndexes).toEqual([0])
      expect(result.current.getInstallablePlugins()).toEqual({
        selectedIndexes: [1],
        installablePlugins: [
          expect.objectContaining({
            plugin_id: 'package-plugin-uid',
          }),
        ],
      })
    })

    it('should expose empty version info and skip unloaded plugins when no package dependency exists', () => {
      const { result } = renderHook(() => useInstallMultiState({
        allPlugins: [
          {
            type: 'github',
            value: {
              repo: 'org/unloaded',
              version: '1.0.0',
              package: 'tool',
            },
          },
        ] as Dependency[],
        selectedPlugins: [],
        onSelect: vi.fn(),
        onLoadedAllPlugin: vi.fn(),
      }))

      expect(result.current.plugins).toEqual([undefined])
      expect(result.current.getVersionInfo('missing/plugin')).toEqual({
        hasInstalled: false,
        installedVersion: undefined,
        toInstallVersion: '',
      })
      expect(result.current.getInstallablePlugins()).toEqual({
        selectedIndexes: [],
        installablePlugins: [],
      })
    })

    it('should mark malformed marketplace dependencies as errors and normalize explicit marketplace info', () => {
      mockUseFetchPluginsInMarketPlaceByInfo.mockReturnValue({
        isLoading: false,
        data: null,
        error: new Error('marketplace failed'),
      } as unknown as ReturnType<typeof useFetchPluginsInMarketPlaceByInfo>)

      const { result } = renderHook(() => useInstallMultiState({
        allPlugins: [
          {
            type: 'marketplace',
            value: {},
          },
          {
            type: 'marketplace',
            value: {
              marketplace_plugin_unique_identifier: 'broken',
            },
          },
          {
            type: 'marketplace',
            value: {
              marketplace_plugin_unique_identifier: 'org/',
            },
          },
          {
            type: 'marketplace',
            value: {
              organization: 'explicit-org',
              plugin: 'explicit-plugin',
              version: '2.0.0',
            },
          },
        ] as Dependency[],
        selectedPlugins: [],
        onSelect: vi.fn(),
        onLoadedAllPlugin: vi.fn(),
      }))

      expect(mockUseFetchPluginsInMarketPlaceByInfo).toHaveBeenCalledWith([
        {
          organization: 'explicit-org',
          plugin: 'explicit-plugin',
          version: '2.0.0',
        },
      ])
      expect(result.current.errorIndexes).toEqual([0, 1, 2, 3])
    })
  })
})
