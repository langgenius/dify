import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createHttpError } from '@/service/http-error'
import {
  useAgentConfigureBuildDraftActions,
  useAgentConfigureBuildDraftData,
} from '../use-agent-configure-build-draft'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  finalize: vi.fn(),
  apply: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.buildDraft.get': mocks.request,
      'agent.byAgentId.buildChat.finalize.post': mocks.finalize,
      'agent.byAgentId.buildDraft.apply.post': mocks.apply,
    }),
  }
})

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
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: 'agent-1' } })

    const notFound = createHttpError(new Response(null, { status: 404 }))
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
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ params: { agent_id: 'agent-1' } })

    const serverError = createHttpError(new Response(null, { status: 500 }))
    mocks.request.mockRejectedValueOnce(serverError)
    await act(async () => {
      const refreshed = await result.current.refetch()
      expect(refreshed.error).toBe(serverError)
    })

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('HTTP 500')
    expect(setSoulSourceOverride).not.toHaveBeenCalled()
  })
})

describe('applying a build draft', () => {
  it.each(['finalize', 'apply'] as const)(
    'reports a failed %s request once and allows retry',
    async (operation) => {
      mocks.finalize.mockReset().mockResolvedValue({})
      mocks.apply.mockReset().mockResolvedValue({})
      mocks[operation].mockRejectedValueOnce(new Error('Apply failed'))
      const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      const resetBuildChatSession = vi.fn().mockResolvedValue(undefined)
      const rebaseComposerDraft = vi.fn()
      const wrapper = ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(
        () =>
          useAgentConfigureBuildDraftActions({
            agentId: 'agent-1',
            isActive: true,
            rebaseComposerDraft,
            refetchBuildDraft: vi.fn().mockResolvedValue({}),
            refetchComposer: vi.fn().mockResolvedValue({}),
            resetBuildChatSession,
            saveDraft: vi.fn().mockResolvedValue(undefined),
            setSoulSourceOverride: vi.fn(),
          }),
        { wrapper },
      )

      await act(async () => result.current.applyBuildDraft())

      expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Apply failed')
      expect(result.current.isApplyingBuildDraft).toBe(false)
      expect(resetBuildChatSession).not.toHaveBeenCalled()
      expect(rebaseComposerDraft).not.toHaveBeenCalled()
      if (operation === 'finalize') expect(mocks.apply).not.toHaveBeenCalled()

      await act(async () => result.current.applyBuildDraft())

      expect(mocks.toastError).toHaveBeenCalledTimes(1)
      expect(resetBuildChatSession).toHaveBeenCalledOnce()
      expect(rebaseComposerDraft).toHaveBeenCalledOnce()
    },
  )
})
