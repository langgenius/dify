import { waitFor } from '@testing-library/react'
import { PluginSource } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery as renderHook,
} from '@/test/console/query-data'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { usePluginInstalledCheck } from '../use-plugin-installed-check'

const requests = vi.hoisted(() => ({ installed: vi.fn(), marketplace: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  getMarketplace: requests.marketplace,
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

beforeEach(() => {
  requests.installed.mockResolvedValue({ plugins: [] })
  requests.marketplace.mockResolvedValue({
    data: { plugin: { name: 'Test plugin', version: '1.0.0' } },
  })
})

it('finds marketplace metadata for the requested plugin', async () => {
  const { result } = renderHook(() => usePluginInstalledCheck({ providerPluginId: 'org/plugin' }))
  await waitFor(() => expect(result.current.inMarketPlace).toBe(true))
  expect(result.current.pluginID).toBe('org/plugin')
  expect(result.current.manifest).toMatchObject({ name: 'Test plugin' })
  expect(requests.installed).toHaveBeenCalledWith({ body: { plugin_ids: ['org/plugin'] } })
  expect(requests.marketplace).toHaveBeenCalledWith('/plugins/org/plugin')
})

it.each([undefined, null, ''])(
  'skips requests for a non-plugin provider (%s)',
  (providerPluginId) => {
    const { result } = renderHook(() => usePluginInstalledCheck({ providerPluginId }))
    expect(result.current.pluginID).toBe('')
    expect(result.current.inMarketPlace).toBe(false)
    expect(requests.installed).not.toHaveBeenCalled()
    expect(requests.marketplace).not.toHaveBeenCalled()
  },
)

it('skips both requests while checks are disabled', () => {
  renderHook(() => usePluginInstalledCheck({ providerPluginId: 'org/plugin', enabled: false }))
  expect(requests.installed).not.toHaveBeenCalled()
  expect(requests.marketplace).not.toHaveBeenCalled()
})

it('does not query marketplace when the cached installation is a local package', async () => {
  const queryClient = createConsoleQueryClient()
  const plugins = [createPluginEntity({ source: PluginSource.local, plugin_id: 'org/plugin' })]
  requests.installed.mockResolvedValue({ plugins })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryKey({
      input: { body: { plugin_ids: ['org/plugin'] } },
    }),
    { plugins },
  )
  const { result } = renderHook(() => usePluginInstalledCheck({ providerPluginId: 'org/plugin' }), {
    queryClient,
  })
  await waitFor(() => expect(requests.installed).toHaveBeenCalled())
  expect(result.current.inMarketPlace).toBe(false)
  expect(requests.marketplace).not.toHaveBeenCalled()
})
