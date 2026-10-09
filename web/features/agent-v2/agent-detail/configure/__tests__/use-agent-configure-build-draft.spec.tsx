import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAgentConfigureBuildDraftData } from '../use-agent-configure-build-draft'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: mocks.toastError },
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        buildDraft: {
          get: {
            queryOptions: ({ context }: { context?: { silent?: boolean } }) => ({
              queryKey: ['agent', 'agent-1', 'build-draft'],
              queryFn: async () => {
                try {
                  return await mocks.request()
                } catch (error) {
                  if (!context?.silent) mocks.toastError('Request failed')
                  throw error
                }
              },
            }),
          },
        },
      },
    },
  },
}))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const setSoulSourceOverride = vi.fn()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () =>
      useAgentConfigureBuildDraftData({
        agentId: 'agent-1',
        activeVersionId: 'version-1',
        isBuildMode: true,
        isViewingVersion: false,
        setSoulSourceOverride,
        soulSourceOverride: null,
      }),
    { wrapper },
  )

  return { ...hook, setSoulSourceOverride }
}

describe('build draft refresh errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockReset()
  })

  it('returns to the normal draft without a toast when a later refresh finds no build draft', async () => {
    mocks.request.mockResolvedValueOnce({ draft: { id: 'build-draft-1' } })
    const { result, setSoulSourceOverride } = setup()
    await waitFor(() => expect(result.current.isActive).toBe(true))

    const notFound = new Response(null, { status: 404 })
    mocks.request.mockRejectedValueOnce(notFound)
    await act(async () => {
      const refreshed = await result.current.refetch()
      expect(refreshed.error).toBe(notFound)
    })

    await waitFor(() => expect(result.current.soulSource).toBe('draft'))
    expect(setSoulSourceOverride).toHaveBeenCalledWith('draft')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('still notifies when refreshing the build draft fails unexpectedly', async () => {
    mocks.request.mockResolvedValueOnce({ draft: { id: 'build-draft-1' } })
    const { result, setSoulSourceOverride } = setup()
    await waitFor(() => expect(result.current.isActive).toBe(true))

    const serverError = new Response(null, { status: 500 })
    mocks.request.mockRejectedValueOnce(serverError)
    await act(async () => {
      const refreshed = await result.current.refetch()
      expect(refreshed.error).toBe(serverError)
    })

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(setSoulSourceOverride).not.toHaveBeenCalled()
  })
})
