import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { usePluginDependencies } from '../hooks'
import { useStore } from '../store'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  error: vi.fn(),
  pipeline: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      imports: {
        byAppId: {
          checkDependencies: {
            get: {
              mutationOptions: ({ context }: { context: { silent: boolean } }) => ({
                mutationFn: (input: unknown) => mocks.request(input, context),
              }),
            },
          },
        },
      },
    },
  },
}))
vi.mock('@/service/use-pipeline', () => ({
  useCheckPipelineDependencies: () => ({ mutateAsync: mocks.pipeline }),
}))
vi.mock('@/app/notifications', () => ({ toast: { error: mocks.error } }))

function renderDependencies() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return renderHook(usePluginDependencies, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

describe('usePluginDependencies', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores generated dependencies with nullable versions and clears an omitted dependency list', async () => {
    const dependency = {
      type: 'marketplace',
      value: { marketplace_plugin_unique_identifier: 'plugin-1', version: null },
    }
    mocks.request
      .mockResolvedValueOnce({ leaked_dependencies: [dependency] })
      .mockResolvedValueOnce({})
    const { result } = renderDependencies()
    await act(async () =>
      expect(await result.current.handleCheckPluginDependencies('app-1')).toBe(true),
    )
    expect(useStore.getState().dependencies).toEqual([
      { ...dependency, value: { ...dependency.value, version: undefined } },
    ])
    expect(mocks.request).toHaveBeenCalledWith({ params: { app_id: 'app-1' } }, { silent: true })
    await act(async () => result.current.handleCheckPluginDependencies('app-1'))
    expect(useStore.getState().dependencies).toEqual([])
  })

  it.each([
    [new TypeError('Network unavailable'), 'Network unavailable'],
    [
      Response.json({ message: 'Dependency check unavailable' }, { status: 503 }),
      'Dependency check unavailable',
    ],
  ])(
    'reports a request failure once without rejecting the completed import',
    async (error, description) => {
      useStore.getState().setDependencies([
        {
          type: 'marketplace',
          value: { marketplace_plugin_unique_identifier: 'previous-app-plugin' },
        },
      ])
      mocks.request.mockRejectedValue(error)
      const { result } = renderDependencies()
      await act(async () =>
        expect(await result.current.handleCheckPluginDependencies('app-1')).toBe(false),
      )
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith('common.error', { description })
      expect(useStore.getState().dependencies).toEqual([])
    },
  )
})
