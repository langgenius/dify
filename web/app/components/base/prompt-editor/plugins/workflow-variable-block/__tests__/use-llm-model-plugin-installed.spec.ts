import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useLlmModelPluginInstalled } from '../use-llm-model-plugin-installed'

const providerSummaryFixture = {
  provider: 'openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI' },
  configurate_methods: ['predefined-model'],
  supported_model_types: ['llm'],
  preferred_provider_type: 'custom',
  is_configured: true,
  system_configuration: { enabled: false },
  custom_configuration: {
    status: 'active',
    available_credentials: [],
    current_credential_usable: true,
    has_custom_models: false,
  },
} satisfies ModelProviderSummaryResponse

let mockModelProviders: Array<{ provider: string }> = []

const createWorkflowNodesMap = (node: Record<string, unknown>): WorkflowNodesMap =>
  ({
    target: {
      title: 'Target',
      type: BlockEnum.Start,
      ...node,
    },
  }) as unknown as WorkflowNodesMap

const renderHook: typeof renderHookWithConsoleQuery = (callback, options) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: mockModelProviders.map(
      (provider) =>
        ({ ...providerSummaryFixture, ...provider }) satisfies ModelProviderSummaryResponse,
    ),
    plugins: {},
  })
  return renderHookWithConsoleQuery(callback, { ...options, queryClient })
}

describe('useLlmModelPluginInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelProviders = []
  })

  it('should return true when the node is missing', () => {
    const { result } = renderHook(() => useLlmModelPluginInstalled('target', undefined))

    expect(result.current).toBe(true)
  })

  it('should return true when the node is not an LLM node', () => {
    const workflowNodesMap = createWorkflowNodesMap({
      id: 'target',
      type: BlockEnum.Start,
    })

    const { result } = renderHook(() => useLlmModelPluginInstalled('target', workflowNodesMap))

    expect(result.current).toBe(true)
  })

  it('should return true when the matching model plugin is installed', () => {
    mockModelProviders = [
      { provider: 'langgenius/openai/openai' },
      { provider: 'langgenius/anthropic/claude' },
    ]
    const workflowNodesMap = createWorkflowNodesMap({
      id: 'target',
      type: BlockEnum.LLM,
      modelProvider: 'langgenius/openai/gpt-4.1',
    })

    const { result } = renderHook(() => useLlmModelPluginInstalled('target', workflowNodesMap))

    expect(result.current).toBe(true)
  })

  it('should return false when the matching model plugin is not installed', () => {
    mockModelProviders = [{ provider: 'langgenius/anthropic/claude' }]
    const workflowNodesMap = createWorkflowNodesMap({
      id: 'target',
      type: BlockEnum.LLM,
      modelProvider: 'langgenius/openai/gpt-4.1',
    })

    const { result } = renderHook(() => useLlmModelPluginInstalled('target', workflowNodesMap))

    expect(result.current).toBe(false)
  })
})
