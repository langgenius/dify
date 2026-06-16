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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
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
    ...renderHook(() => useAgentConfigureSync({ agentId: 'agent-1' }), { wrapper }),
    store,
  }
}

describe('useAgentConfigureSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not save the configure page draft as a published version automatically', () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft only prompt',
      })
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
  })

  it('should publish only when publishDraft is called explicitly', async () => {
    const { result } = renderUseAgentConfigureSync()

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
  })
})
