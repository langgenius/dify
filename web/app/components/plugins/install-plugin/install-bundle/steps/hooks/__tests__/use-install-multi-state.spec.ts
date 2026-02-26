import type { Dependency, GitHubItemAndMarketPlaceDependency, PackageDependency, Plugin, VersionInfo } from '@/app/components/plugins/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { getPluginKey, useInstallMultiState } from '../use-install-multi-state'

let mockMarketplaceData: ReturnType<typeof createMarketplaceApiData> | null = null
let mockMarketplaceError: Error | null = null
let mockInstalledInfo: Record<string, VersionInfo> = {}
let mockCanInstall = true

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByInfo: () => ({
    isLoading: false,
    data: mockMarketplaceData,
    error: mockMarketplaceError,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => ({
    installedInfo: mockInstalledInfo,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({}),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit', () => ({
  pluginInstallLimit: () => ({ canInstall: mockCanInstall }),
}))

const createMockPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'Test Plugin',
  plugin_id: 'test-plugin-id',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-pkg-id',
  icon: 'icon.png',
  verified: true,
  label: { 'en-US': 'Test Plugin' },
  brief: { 'en-US': 'Brief' },
  description: { 'en-US': 'Description' },
  introduction: 'Intro',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 100,
  endpoint: { settings: [] },
  tags: [],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createPackageDependency = (index: number) => ({
  type: 'package',
  value: {
    unique_identifier: `package-plugin-${index}-uid`,
    manifest: {
      plugin_unique_identifier: `package-plugin-${index}-uid`,
      version: '1.0.0',
      author: 'test-author',
      icon: 'icon.png',
      name: `Package Plugin ${index}`,
      category: PluginCategoryEnum.tool,
      label: { 'en-US': `Package Plugin ${index}` },
      description: { 'en-US': 'Test package plugin' },
      created_at: '2024-01-01',
      resource: {},
      plugins: [],
      verified: true,
      endpoint: { settings: [], endpoints: [] },
      model: null,
      tags: [],
      agent_strategy: null,
      meta: { version: '1.0.0' },
      trigger: {},
    },
  },
} as unknown as PackageDependency)

const createMarketplaceDependency = (index: number): GitHubItemAndMarketPlaceDependency => ({
  type: 'marketplace',
  value: {
    marketplace_plugin_unique_identifier: `test-org/plugin-${index}:1.0.0`,
    plugin_unique_identifier: `plugin-${index}`,
    version: '1.0.0',
  },
})

const createGitHubDependency = (index: number): GitHubItemAndMarketPlaceDependency => ({
  type: 'github',
  value: {
    repo: `test-org/plugin-${index}`,
    version: 'v1.0.0',
    package: `plugin-${index}.zip`,
  },
})

const createMarketplaceApiData = (indexes: number[]) => ({
  data: {
    list: indexes.map(i => ({
      plugin: {
        plugin_id: `test-org/plugin-${i}`,
        org: 'test-org',
        name: `Test Plugin ${i}`,
        version: '1.0.0',
        latest_version: '1.0.0',
      },
      version: {
        unique_identifier: `plugin-${i}-uid`,
      },
    })),
  },
})

const createDefaultParams = (overrides = {}) => ({
  allPlugins: [createPackageDependency(0)] as Dependency[],
  selectedPlugins: [] as Plugin[],
  onSelect: vi.fn(),
  onLoadedAllPlugin: vi.fn(),
  ...overrides,
})

// ==================== getPluginKey Tests ====================

describe('getPluginKey', () => {
  it('should return org/name when org is available', () => {
    const plugin = createMockPlugin({ org: 'my-org', name: 'my-plugin' })

    expect(getPluginKey(plugin)).toBe('my-org/my-plugin')
  })

  it('should fall back to author when org is not available', () => {
    const plugin = createMockPlugin({ org: undefined, author: 'my-author', name: 'my-plugin' })

    expect(getPluginKey(plugin)).toBe('my-author/my-plugin')
  })

  it('should prefer org over author when both exist', () => {
    const plugin = createMockPlugin({ org: 'my-org', author: 'my-author', name: 'my-plugin' })

    expect(getPluginKey(plugin)).toBe('my-org/my-plugin')
  })

  it('should handle undefined plugin', () => {
    expect(getPluginKey(undefined)).toBe('undefined/undefined')
  })
})

// ==================== useInstallMultiState Tests ====================

describe('useInstallMultiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketplaceData = null
    mockMarketplaceError = null
    mockInstalledInfo = {}
    mockCanInstall = true
  })

  // ==================== Initial State ====================
  describe('Initial State', () => {
    it('should initialize plugins from package dependencies', () => {
      const params = createDefaultParams()
      const { result } = renderHook(() => useInstallMultiState(params))

      expect(result.current.plugins).toHaveLength(1)
      expect(result.current.plugins[0]).toBeDefined()
      expect(result.current.plugins[0]?.plugin_id).toBe('package-plugin-0-uid')
    })

    it('should have slots for all dependencies even when no packages exist', () => {
      const params = createDefaultParams({
        allPlugins: [createGitHubDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      // Array has slots for all dependencies, but unresolved ones are undefined
      expect(result.current.plugins).toHaveLength(1)
      expect(result.current.plugins[0]).toBeUndefined()
    })

    it('should return undefined for non-package items in mixed dependencies', () => {
      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createGitHubDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      expect(result.current.plugins).toHaveLength(2)
      expect(result.current.plugins[0]).toBeDefined()
      expect(result.current.plugins[1]).toBeUndefined()
    })

    it('should start with empty errorIndexes', () => {
      const params = createDefaultParams()
      const { result } = renderHook(() => useInstallMultiState(params))

      expect(result.current.errorIndexes).toEqual([])
    })
  })

  // ==================== Marketplace Data Sync ====================
  describe('Marketplace Data Sync', () => {
    it('should update plugins when marketplace data loads by ID', async () => {
      mockMarketplaceData = createMarketplaceApiData([0])

      const params = createDefaultParams({
        allPlugins: [createMarketplaceDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await waitFor(() => {
        expect(result.current.plugins[0]).toBeDefined()
        expect(result.current.plugins[0]?.version).toBe('1.0.0')
      })
    })

    it('should update plugins when marketplace data loads by meta', async () => {
      mockMarketplaceData = createMarketplaceApiData([0])

      const params = createDefaultParams({
        allPlugins: [createMarketplaceDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      // The "by meta" effect sets plugin_id from version.unique_identifier
      await waitFor(() => {
        expect(result.current.plugins[0]).toBeDefined()
      })
    })

    it('should add to errorIndexes when marketplace item not found in response', async () => {
      mockMarketplaceData = { data: { list: [] } }

      const params = createDefaultParams({
        allPlugins: [createMarketplaceDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await waitFor(() => {
        expect(result.current.errorIndexes).toContain(0)
      })
    })

    it('should handle multiple marketplace plugins', async () => {
      mockMarketplaceData = createMarketplaceApiData([0, 1])

      const params = createDefaultParams({
        allPlugins: [
          createMarketplaceDependency(0),
          createMarketplaceDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await waitFor(() => {
        expect(result.current.plugins[0]).toBeDefined()
        expect(result.current.plugins[1]).toBeDefined()
      })
    })
  })

  // ==================== Error Handling ====================
  describe('Error Handling', () => {
    it('should mark all marketplace indexes as errors on fetch failure', async () => {
      mockMarketplaceError = new Error('Fetch failed')

      const params = createDefaultParams({
        allPlugins: [
          createMarketplaceDependency(0),
          createMarketplaceDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await waitFor(() => {
        expect(result.current.errorIndexes).toContain(0)
        expect(result.current.errorIndexes).toContain(1)
      })
    })

    it('should not affect non-marketplace indexes on marketplace fetch error', async () => {
      mockMarketplaceError = new Error('Fetch failed')

      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createMarketplaceDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await waitFor(() => {
        expect(result.current.errorIndexes).toContain(1)
        expect(result.current.errorIndexes).not.toContain(0)
      })
    })
  })

  // ==================== Loaded All Data Notification ====================
  describe('Loaded All Data Notification', () => {
    it('should call onLoadedAllPlugin when all data loaded', async () => {
      const params = createDefaultParams()
      renderHook(() => useInstallMultiState(params))

      await waitFor(() => {
        expect(params.onLoadedAllPlugin).toHaveBeenCalledWith(mockInstalledInfo)
      })
    })

    it('should not call onLoadedAllPlugin when not all plugins resolved', () => {
      // GitHub plugin not fetched yet → isLoadedAllData = false
      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createGitHubDependency(1),
        ] as Dependency[],
      })
      renderHook(() => useInstallMultiState(params))

      expect(params.onLoadedAllPlugin).not.toHaveBeenCalled()
    })

    it('should call onLoadedAllPlugin after all errors are counted', async () => {
      mockMarketplaceError = new Error('Fetch failed')

      const params = createDefaultParams({
        allPlugins: [createMarketplaceDependency(0)] as Dependency[],
      })
      renderHook(() => useInstallMultiState(params))

      // Error fills errorIndexes → isLoadedAllData becomes true
      await waitFor(() => {
        expect(params.onLoadedAllPlugin).toHaveBeenCalled()
      })
    })
  })

  // ==================== handleGitHubPluginFetched ====================
  describe('handleGitHubPluginFetched', () => {
    it('should update plugin at the specified index', async () => {
      const params = createDefaultParams({
        allPlugins: [createGitHubDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))
      const mockPlugin = createMockPlugin({ plugin_id: 'github-plugin-0' })

      await act(async () => {
        result.current.handleGitHubPluginFetched(0)(mockPlugin)
      })

      expect(result.current.plugins[0]).toEqual(mockPlugin)
    })

    it('should not affect other plugin slots', async () => {
      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createGitHubDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))
      const originalPlugin0 = result.current.plugins[0]
      const mockPlugin = createMockPlugin({ plugin_id: 'github-plugin-1' })

      await act(async () => {
        result.current.handleGitHubPluginFetched(1)(mockPlugin)
      })

      expect(result.current.plugins[0]).toEqual(originalPlugin0)
      expect(result.current.plugins[1]).toEqual(mockPlugin)
    })
  })

  // ==================== handleGitHubPluginFetchError ====================
  describe('handleGitHubPluginFetchError', () => {
    it('should add index to errorIndexes', async () => {
      const params = createDefaultParams({
        allPlugins: [createGitHubDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await act(async () => {
        result.current.handleGitHubPluginFetchError(0)()
      })

      expect(result.current.errorIndexes).toContain(0)
    })

    it('should accumulate multiple error indexes without stale closure', async () => {
      const params = createDefaultParams({
        allPlugins: [
          createGitHubDependency(0),
          createGitHubDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await act(async () => {
        result.current.handleGitHubPluginFetchError(0)()
      })
      await act(async () => {
        result.current.handleGitHubPluginFetchError(1)()
      })

      expect(result.current.errorIndexes).toContain(0)
      expect(result.current.errorIndexes).toContain(1)
    })
  })

  // ==================== getVersionInfo ====================
  describe('getVersionInfo', () => {
    it('should return hasInstalled false when plugin not installed', () => {
      const params = createDefaultParams()
      const { result } = renderHook(() => useInstallMultiState(params))

      const info = result.current.getVersionInfo('unknown/plugin')

      expect(info.hasInstalled).toBe(false)
      expect(info.installedVersion).toBeUndefined()
      expect(info.toInstallVersion).toBe('')
    })

    it('should return hasInstalled true with version when installed', () => {
      mockInstalledInfo = {
        'test-author/Package Plugin 0': {
          installedId: 'installed-1',
          installedVersion: '0.9.0',
          uniqueIdentifier: 'uid-1',
        },
      }
      const params = createDefaultParams()
      const { result } = renderHook(() => useInstallMultiState(params))

      const info = result.current.getVersionInfo('test-author/Package Plugin 0')

      expect(info.hasInstalled).toBe(true)
      expect(info.installedVersion).toBe('0.9.0')
    })
  })

  // ==================== handleSelect ====================
  describe('handleSelect', () => {
    it('should call onSelect with plugin, index, and installable count', async () => {
      const params = createDefaultParams()
      const { result } = renderHook(() => useInstallMultiState(params))

      await act(async () => {
        result.current.handleSelect(0)()
      })

      expect(params.onSelect).toHaveBeenCalledWith(
        result.current.plugins[0],
        0,
        expect.any(Number),
      )
    })

    it('should filter installable plugins using pluginInstallLimit', async () => {
      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createPackageDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      await act(async () => {
        result.current.handleSelect(0)()
      })

      // mockCanInstall is true, so all 2 plugins are installable
      expect(params.onSelect).toHaveBeenCalledWith(
        expect.anything(),
        0,
        2,
      )
    })
  })

  // ==================== isPluginSelected ====================
  describe('isPluginSelected', () => {
    it('should return true when plugin is in selectedPlugins', () => {
      const selectedPlugin = createMockPlugin({ plugin_id: 'package-plugin-0-uid' })
      const params = createDefaultParams({
        selectedPlugins: [selectedPlugin],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      expect(result.current.isPluginSelected(0)).toBe(true)
    })

    it('should return false when plugin is not in selectedPlugins', () => {
      const params = createDefaultParams({ selectedPlugins: [] })
      const { result } = renderHook(() => useInstallMultiState(params))

      expect(result.current.isPluginSelected(0)).toBe(false)
    })

    it('should return false when plugin at index is undefined', () => {
      const params = createDefaultParams({
        allPlugins: [createGitHubDependency(0)] as Dependency[],
        selectedPlugins: [createMockPlugin()],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      // plugins[0] is undefined (GitHub not yet fetched)
      expect(result.current.isPluginSelected(0)).toBe(false)
    })
  })

  // ==================== getInstallablePlugins ====================
  describe('getInstallablePlugins', () => {
    it('should return all plugins when canInstall is true', () => {
      mockCanInstall = true
      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createPackageDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      const { installablePlugins, selectedIndexes } = result.current.getInstallablePlugins()

      expect(installablePlugins).toHaveLength(2)
      expect(selectedIndexes).toEqual([0, 1])
    })

    it('should return empty arrays when canInstall is false', () => {
      mockCanInstall = false
      const params = createDefaultParams({
        allPlugins: [createPackageDependency(0)] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      const { installablePlugins, selectedIndexes } = result.current.getInstallablePlugins()

      expect(installablePlugins).toHaveLength(0)
      expect(selectedIndexes).toEqual([])
    })

    it('should skip unloaded (undefined) plugins', () => {
      mockCanInstall = true
      const params = createDefaultParams({
        allPlugins: [
          createPackageDependency(0),
          createGitHubDependency(1),
        ] as Dependency[],
      })
      const { result } = renderHook(() => useInstallMultiState(params))

      const { installablePlugins, selectedIndexes } = result.current.getInstallablePlugins()

      // Only package plugin is loaded; GitHub not yet fetched
      expect(installablePlugins).toHaveLength(1)
      expect(selectedIndexes).toEqual([0])
    })
  })
})
