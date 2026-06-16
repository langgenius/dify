import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { FlowType } from '@/types/common'
import { renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useCreateInlineAgentBinding } from '../hooks'

const mockDefaultModel = vi.hoisted(() => ({
  value: {
    model: 'gpt-4o-mini',
    model_type: 'llm',
    provider: {
      provider: 'langgenius/openai/openai',
      icon_small: {
        en_US: 'openai',
        zh_Hans: 'openai',
      },
    },
  },
}))
const mockComposerMutationFn = vi.hoisted(() => vi.fn(async (variables: unknown) => ({
  binding: {
    binding_type: 'inline_agent',
    agent_id: 'inline-agent-1',
    current_snapshot_id: 'inline-snapshot-1',
  },
  variables,
})))
const mockComposerMutationOptions = vi.hoisted(() => vi.fn(() => ({
  mutationFn: mockComposerMutationFn,
})))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: mockDefaultModel.value,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        get: {
          queryOptions: vi.fn(),
        },
      },
    },
    apps: {
      byAppId: {
        workflows: {
          draft: {
            nodes: {
              byNodeId: {
                agentComposer: {
                  put: {
                    mutationOptions: mockComposerMutationOptions,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}))

describe('useCreateInlineAgentBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates inline agent with the default text generation model', async () => {
    const onSuccess = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: {
          retry: false,
        },
      },
    })
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      hooksStoreProps: {
        configsMap: {
          flowId: 'app-1',
          flowType: FlowType.appFlow,
          fileSettings: {} as never,
        },
      },
    })

    act(() => {
      result.current.createInlineAgentBinding('node-1', { onSuccess })
    })

    await waitFor(() => expect(mockComposerMutationFn).toHaveBeenCalled())
    expect(mockComposerMutationFn).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'node_job_only',
        soul_lock: {
          locked: false,
        },
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: '',
          },
          model: {
            model_provider: 'langgenius/openai/openai',
            model: 'gpt-4o-mini',
            plugin_id: 'langgenius/openai',
          },
        },
      },
    }, expect.any(Object))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({
      binding_type: 'inline_agent',
      agent_id: 'inline-agent-1',
      current_snapshot_id: 'inline-snapshot-1',
    }))
  })
})
