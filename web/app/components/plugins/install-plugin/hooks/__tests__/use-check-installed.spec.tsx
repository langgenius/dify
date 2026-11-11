import { act, waitFor } from '@testing-library/react'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import useCheckInstalled from '../use-check-installed'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': request,
    }),
  }
})

beforeEach(() => {
  request.mockResolvedValue({ plugins: [] })
})

it('waits for installed plugins and maps their server identities and versions', async () => {
  const pending = createDeferred<{ plugins: ReturnType<typeof createPluginEntity>[] }>()
  request.mockReturnValue(pending.promise)
  const plugin = createPluginEntity()
  const { result } = renderHook(() =>
    useCheckInstalled({ pluginIds: [plugin.plugin_id], enabled: true }),
  )
  expect(result.current.isLoading).toBe(true)
  expect(result.current.installedInfo).toBeUndefined()
  await act(async () => pending.resolve({ plugins: [plugin] }))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(request).toHaveBeenCalledWith({ body: { plugin_ids: [plugin.plugin_id] } })
  expect(result.current.installedInfo).toEqual({
    [plugin.plugin_id]: {
      installedId: plugin.id,
      installedVersion: plugin.declaration.version,
      uniqueIdentifier: plugin.plugin_unique_identifier,
    },
  })
})

it('starts the installation lookup only after the caller enables it', async () => {
  const { result, rerender } = renderHook(
    ({ enabled }) => useCheckInstalled({ pluginIds: ['plugin-1'], enabled }),
    { initialProps: { enabled: false } },
  )
  expect(request).not.toHaveBeenCalled()
  expect(result.current.installedInfo).toBeUndefined()
  rerender({ enabled: true })
  await waitFor(() => expect(result.current.installedInfo).toEqual({}))
  expect(request).toHaveBeenCalledOnce()
})

it('exposes lookup failures without manufacturing an installed result', async () => {
  const error = new Error('lookup failed')
  request.mockRejectedValue(error)
  const { result } = renderHook(() => useCheckInstalled({ pluginIds: ['plugin-1'], enabled: true }))
  await waitFor(() => expect(result.current.error).toBe(error))
  expect(result.current.installedInfo).toBeUndefined()
  expect(result.current.isLoading).toBe(false)
})
