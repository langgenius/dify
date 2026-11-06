import type {
  Dependency,
  GitHubItemAndMarketPlaceDependency,
  PackageDependency,
  Plugin,
} from '@/app/components/plugins/types'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { useInstallMultiState } from '../use-install-multi-state'

const requests = vi.hoisted(() => ({ marketplace: vi.fn(), installed: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: requests.marketplace,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': requests.installed,
    }),
  }
})

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

const packageDependency: PackageDependency = {
  type: 'package',
  value: {
    unique_identifier: 'test/local:1.0.0',
    manifest: createPluginDeclarationFixture({ author: 'test', name: 'local' }),
  },
}
const githubDependency: Dependency = {
  type: 'github',
  value: { repo: 'test/github', release: 'v1.0.0', packages: 'plugin.difypkg' },
}
const marketplaceDependency: GitHubItemAndMarketPlaceDependency = {
  type: 'marketplace',
  value: { marketplace_plugin_unique_identifier: 'test/remote:1.0.0@hash' },
}
const params = (allPlugins: Dependency[]) => ({
  allPlugins,
  selectedPlugins: [] as Plugin[],
  onSelect: vi.fn(),
  onLoadedAllPlugin: vi.fn(),
})

beforeEach(() => {
  vi.clearAllMocks()
  requests.installed.mockResolvedValue({ plugins: [] })
  requests.marketplace.mockResolvedValue({ data: { list: [] } })
})

describe('bundle metadata', () => {
  it.each([
    { marketplace_plugin_unique_identifier: 'test/remote:1.0.0@hash' },
    { organization: 'test', plugin: 'remote', version: '1.0.0' },
  ])('normalizes dependency %j and maps metadata back to the original slots', async (value) => {
    const remote = createMockPlugin({ org: 'test', name: 'remote', plugin_id: 'test/remote' })
    const second = createMockPlugin({
      org: 'test',
      name: 'second',
      plugin_id: 'test/second',
      version: '',
      latest_version: '2.0.0',
    })
    // For identifier dependencies, the response can arrive in a different order.
    const responseOrder =
      'marketplace_plugin_unique_identifier' in value ? [remote, second] : [second, remote]
    requests.marketplace.mockResolvedValue({
      data: { list: responseOrder.map((plugin) => ({ plugin })) },
    })
    const input = params([
      packageDependency,
      { type: 'marketplace', value: { marketplace_plugin_unique_identifier: 'test/second:2.0.0' } },
      { type: 'marketplace', value },
    ])
    const { result } = renderHook(() => useInstallMultiState(input))
    await waitFor(() => expect(input.onLoadedAllPlugin).toHaveBeenCalledWith({}))
    expect(requests.marketplace).toHaveBeenCalledWith('/plugins/versions/batch', {
      body: {
        plugin_tuples: [
          { org: 'test', name: 'second', version: '2.0.0' },
          { org: 'test', name: 'remote', version: '1.0.0' },
        ],
      },
    })
    expect(result.current.plugins).toMatchObject([
      { plugin_id: 'test/local:1.0.0' },
      { plugin_id: 'test/second', version: '2.0.0' },
      { plugin_id: 'test/remote', version: '1.0.0' },
    ])
    expect(requests.installed).toHaveBeenCalledWith({
      body: { plugin_ids: ['test/local', 'test/second', 'test/remote'] },
    })
    expect(result.current.errorIndexes).toEqual([])
  })

  it.each(['invalid-identifier', 'test/:1.0.0', undefined])(
    'rejects malformed marketplace identifier %s without fetching it',
    async (identifier) => {
      const input = params([
        packageDependency,
        { type: 'marketplace', value: { marketplace_plugin_unique_identifier: identifier } },
      ])
      const { result } = renderHook(() => useInstallMultiState(input))
      await waitFor(() => expect(input.onLoadedAllPlugin).toHaveBeenCalledWith({}))
      expect(result.current.errorIndexes).toEqual([1])
      expect(requests.marketplace).not.toHaveBeenCalled()
    },
  )

  it('marks only missing marketplace entries as failed', async () => {
    requests.marketplace.mockResolvedValue({
      data: { list: [{ plugin: createMockPlugin({ plugin_id: 'test/remote' }) }] },
    })
    const input = params([
      packageDependency,
      marketplaceDependency,
      {
        type: 'marketplace',
        value: { marketplace_plugin_unique_identifier: 'test/missing:1.0.0' },
      },
    ])
    const { result } = renderHook(() => useInstallMultiState(input))
    await waitFor(() => expect(input.onLoadedAllPlugin).toHaveBeenCalledWith({}))
    expect(result.current.errorIndexes).toEqual([2])
    expect(result.current.plugins[0]?.plugin_id).toBe('test/local:1.0.0')
    expect(result.current.plugins[1]?.plugin_id).toBe('test/remote')
  })

  it('waits for every source and installed lookup while preserving concurrent GitHub results and failures', async () => {
    requests.marketplace.mockRejectedValueOnce(new Error('Marketplace unavailable'))
    const installed = createDeferred<{ plugins: [] }>()
    requests.installed.mockReturnValueOnce(installed.promise)
    const input = params([
      packageDependency,
      marketplaceDependency,
      githubDependency,
      githubDependency,
      githubDependency,
    ])
    const { result } = renderHook(() => useInstallMultiState(input))
    await waitFor(() => expect(result.current.errorIndexes).toEqual([1]))
    expect(input.onLoadedAllPlugin).not.toHaveBeenCalled()
    expect(requests.installed).not.toHaveBeenCalled()
    const github = createMockPlugin({ org: 'test', name: 'github', plugin_id: 'test/github' })
    act(() => {
      result.current.handleGitHubPluginFetched(2)(github)
      result.current.handleGitHubPluginFetchError(3)()
      result.current.handleGitHubPluginFetchError(4)()
    })
    await waitFor(() => expect(requests.installed).toHaveBeenCalledOnce())
    expect(input.onLoadedAllPlugin).not.toHaveBeenCalled()
    installed.resolve({ plugins: [] })
    await waitFor(() => expect(input.onLoadedAllPlugin).toHaveBeenCalledWith({}))
    expect(result.current.errorIndexes).toEqual([1, 3, 4])
    expect(result.current.plugins).toEqual([
      expect.objectContaining({ plugin_id: 'test/local:1.0.0' }),
      undefined,
      github,
      undefined,
      undefined,
    ])
  })

  it('excludes unresolved plugins from bulk selection before metadata finishes', () => {
    const input = params([packageDependency, githubDependency])
    input.selectedPlugins = [createMockPlugin({ plugin_id: 'test/local:1.0.0' })]
    const { result } = renderHook(() => useInstallMultiState(input), {
      systemFeatures: {
        plugin_installation_permission: {
          plugin_installation_scope: 'all',
          restrict_to_marketplace_only: false,
        },
      },
    })
    expect(result.current.getInstallablePlugins()).toEqual({
      installablePlugins: [expect.objectContaining({ plugin_id: 'test/local:1.0.0' })],
      selectedIndexes: [0],
    })
    expect(result.current.isPluginSelected(0)).toBe(true)
    expect(result.current.isPluginSelected(1)).toBe(false)
    expect(input.onLoadedAllPlugin).not.toHaveBeenCalled()
  })
})
