import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { useAgentConfigureSync } from '../use-agent-configure-sync'

const composerPutMutationFn = vi.hoisted(() => vi.fn(async (variables: {
  body: {
    agent_soul: Record<string, unknown>
  }
}) => ({
  agent_soul: variables.body.agent_soul,
})))

const composerPutMutationOptions = vi.hoisted(() => vi.fn((options?: {
  onSuccess?: (data: { agent_soul: Record<string, unknown> }, variables: {
    params: { agent_id: string }
    body: {
      agent_soul: Record<string, unknown>
    }
  }) => void
}) => ({
  mutationFn: async (variables: {
    params: { agent_id: string }
    body: {
      agent_soul: Record<string, unknown>
    }
  }) => {
    const data = await composerPutMutationFn(variables)
    options?.onSuccess?.(data, variables)
    return data
  },
})))

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
            'agent-detail',
            input.params.agent_id,
          ],
        },
        composer: {
          get: {
            queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
              'agent-composer',
              input.params.agent_id,
            ],
          },
          put: {
            mutationOptions: composerPutMutationOptions,
          },
        },
        versions: {
          get: {
            key: () => ['agent-versions'],
          },
        },
      },
    },
  },
}))

function renderUseAgentConfigureSync() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const store = createStore()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        {children}
      </JotaiProvider>
    </QueryClientProvider>
  )

  return {
    ...renderHook(() => useAgentConfigureSync({
      agentId: 'agent-1',
      enabled: true,
    }), { wrapper }),
    queryClient,
    store,
  }
}

describe('useAgentConfigureSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should automatically save configure page changes to draft', async () => {
    vi.setSystemTime(1710000100000)
    const { queryClient, result, store } = renderUseAgentConfigureSync()

    expect(result.current.draftSavedAt).toBeUndefined()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft only prompt',
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        agent_id: 'agent-1',
      },
      body: expect.objectContaining({
        variant: 'agent_app',
        save_strategy: 'save_to_current_version',
        agent_soul: expect.objectContaining({
          prompt: expect.objectContaining({
            system_prompt: 'Draft only prompt',
          }),
        }),
      }),
    }))
    expect(queryClient.getQueryData(['agent-composer', 'agent-1'])).toBeUndefined()
    expect(result.current.draftSavedAt).toBe(1710000105000)
  })

  it('should save the latest draft immediately when requested', async () => {
    vi.setSystemTime(1710000200000)
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Run prompt',
      })
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        agent_id: 'agent-1',
      },
      body: expect.objectContaining({
        variant: 'agent_app',
        save_strategy: 'save_to_current_version',
        agent_soul: expect.objectContaining({
          prompt: expect.objectContaining({
            system_prompt: 'Run prompt',
          }),
        }),
      }),
    }))
    expect(result.current.draftSavedAt).toBe(1710000200000)
  })

  it('should publish only when publishDraft is called explicitly', async () => {
    const { queryClient, result } = renderUseAgentConfigureSync()
    queryClient.setQueryData(['agent-detail', 'agent-1'], {
      active_config_is_published: false,
      name: 'Agent',
    })

    await act(async () => {
      await result.current.publishDraft({
        agent_id: 'agent-1',
        config_snapshot: {
          prompt: {
            system_prompt: 'Published prompt',
          },
        },
      })
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        agent_id: 'agent-1',
      },
      body: expect.objectContaining({
        variant: 'agent_app',
        save_strategy: 'save_as_new_version',
        agent_soul: {
          prompt: {
            system_prompt: 'Published prompt',
          },
        },
      }),
    }))
    expect(queryClient.getQueryData(['agent-composer', 'agent-1'])).toEqual({
      agent_soul: {
        prompt: {
          system_prompt: 'Published prompt',
        },
      },
    })
    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
  })

  it('should expose publishing status from the publish mutation while publish is pending', async () => {
    const publishDeferred = createDeferredPromise<{ agent_soul: Record<string, unknown> }>()
    composerPutMutationFn.mockReturnValueOnce(publishDeferred.promise)
    const { result } = renderUseAgentConfigureSync()
    const publishPayload = {
      agent_id: 'agent-1',
      config_snapshot: {
        prompt: {
          system_prompt: 'Published prompt',
        },
      },
    }

    let publishPromise!: Promise<void>
    act(() => {
      publishPromise = result.current.publishDraft(publishPayload)
    })

    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isPublishing).toBe(true)

    await act(async () => {
      publishDeferred.resolve({
        agent_soul: publishPayload.config_snapshot,
      })
      await publishPromise
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isPublishing).toBe(false)
  })
})
