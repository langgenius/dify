import type { CheckDependenciesResult } from '@dify/contracts/api/console/apps/types.gen'
import { act } from '@testing-library/react'
import { createHttpError } from '@/service/http-error'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { usePluginDependencies } from '../hooks'
import { useStore } from '../store'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(...args: unknown[]) => Promise<Response>>(),
  error: vi.fn(),
}))

vi.mock('@/service/base', () => ({ request: mocks.request }))
vi.mock('@/app/notifications', () => ({ toast: { error: mocks.error } }))

describe('usePluginDependencies', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    useStore.getState().setDependencies([])
  })

  it.each([
    { resource: 'app', isPipeline: false, path: '/apps/imports/resource-1/check-dependencies' },
    {
      resource: 'pipeline',
      isPipeline: true,
      path: '/rag/pipelines/imports/resource-1/check-dependencies',
    },
  ])(
    'stores $resource dependencies with nullable versions and clears an omitted list',
    async ({ isPipeline, path }) => {
      const dependency = {
        type: 'marketplace',
        value: { marketplace_plugin_unique_identifier: 'plugin-1', version: null },
      } satisfies NonNullable<CheckDependenciesResult['leaked_dependencies']>[number]
      mocks.request
        .mockResolvedValueOnce(Response.json({ leaked_dependencies: [dependency] }))
        .mockResolvedValueOnce(Response.json({}))
      const { result } = renderHookWithConsoleQuery(usePluginDependencies)
      await act(async () =>
        expect(await result.current.handleCheckPluginDependencies('resource-1', isPipeline)).toBe(
          true,
        ),
      )
      expect(useStore.getState().dependencies).toEqual([
        { ...dependency, value: { ...dependency.value, version: undefined } },
      ])
      expect(mocks.request).toHaveBeenCalledWith(
        expect.stringContaining(path),
        expect.any(Object),
        expect.objectContaining({ fetchCompat: true, ...(!isPipeline && { silent: true }) }),
      )
      await act(async () => result.current.handleCheckPluginDependencies('resource-1', isPipeline))
      expect(useStore.getState().dependencies).toEqual([])
    },
  )

  it.each([
    [new TypeError('Network unavailable'), 'Network unavailable'],
    [
      createHttpError(new Response(null, { status: 503 }), {
        message: 'Dependency check unavailable',
      }),
      'Dependency check unavailable',
    ],
  ])('reports app dependency errors and clears stale dependencies', async (error, description) => {
    useStore.getState().setDependencies([
      {
        type: 'marketplace',
        value: { marketplace_plugin_unique_identifier: 'previous-app-plugin' },
      },
    ])
    mocks.request.mockRejectedValue(error)
    const { result } = renderHookWithConsoleQuery(usePluginDependencies)
    await act(async () =>
      expect(await result.current.handleCheckPluginDependencies('app-1')).toBe(false),
    )
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('common.error', { description })
    expect(useStore.getState().dependencies).toEqual([])
  })
})
