import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderHook } from '@/test/console/render'
import {
  useCreateEndpoint,
  useDeleteEndpoint,
  useDisableEndpoint,
  useEnableEndpoint,
  useUpdateEndpoint,
} from '../use-endpoints'

const { mockCreate, mockDelete, mockDisable, mockEnable, mockLegacyPost, mockUpdate } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockDelete: vi.fn(),
    mockDisable: vi.fn(),
    mockEnable: vi.fn(),
    mockLegacyPost: vi.fn(),
    mockUpdate: vi.fn(),
  }),
)

vi.mock('@/service/base', () => ({
  get: vi.fn(),
  post: mockLegacyPost,
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  return {
    ...actual,
    consoleClient: {
      workspaces: {
        current: {
          endpoints: {
            post: mockCreate,
            byId: {
              delete: mockDelete,
              patch: mockUpdate,
            },
            disable: { post: mockDisable },
            enable: { post: mockEnable },
          },
        },
      },
    },
  }
})

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('endpoint mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an endpoint through the generated collection contract without mutating form state', async () => {
    mockCreate.mockResolvedValue({ success: true })
    const state = { name: 'My endpoint', api_key: 'secret' }
    const { result } = renderHook(() => useCreateEndpoint({}), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({ pluginUniqueID: 'plugin-1@1.0.0', state })
    })

    expect(mockCreate).toHaveBeenCalledWith({
      body: {
        name: 'My endpoint',
        plugin_unique_identifier: 'plugin-1@1.0.0',
        settings: { api_key: 'secret' },
      },
    })
    expect(state).toEqual({ name: 'My endpoint', api_key: 'secret' })
    expect(mockLegacyPost).not.toHaveBeenCalled()
  })

  it('updates an endpoint through the generated item contract without mutating form state', async () => {
    mockUpdate.mockResolvedValue({ success: true })
    const state = { name: 'Renamed endpoint', region: 'us-east' }
    const { result } = renderHook(() => useUpdateEndpoint({}), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({ endpointID: 'endpoint-1', state })
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      params: { id: 'endpoint-1' },
      body: {
        name: 'Renamed endpoint',
        settings: { region: 'us-east' },
      },
    })
    expect(state).toEqual({ name: 'Renamed endpoint', region: 'us-east' })
    expect(mockLegacyPost).not.toHaveBeenCalled()
  })

  it('routes endpoint state changes through their generated contracts', async () => {
    mockDelete.mockResolvedValue({ success: true })
    mockDisable.mockResolvedValue({ success: true })
    mockEnable.mockResolvedValue({ success: true })
    const { result } = renderHook(
      () => ({
        deleteEndpoint: useDeleteEndpoint({}),
        disableEndpoint: useDisableEndpoint({}),
        enableEndpoint: useEnableEndpoint({}),
      }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.deleteEndpoint.mutateAsync('endpoint-1')
      await result.current.disableEndpoint.mutateAsync('endpoint-2')
      await result.current.enableEndpoint.mutateAsync('endpoint-3')
    })

    expect(mockDelete).toHaveBeenCalledWith({ params: { id: 'endpoint-1' } })
    expect(mockDisable).toHaveBeenCalledWith({ body: { endpoint_id: 'endpoint-2' } })
    expect(mockEnable).toHaveBeenCalledWith({ body: { endpoint_id: 'endpoint-3' } })
    expect(mockLegacyPost).not.toHaveBeenCalled()
  })
})
