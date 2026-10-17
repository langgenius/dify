import type {
  TrialAppDetailResponse,
  TrialWorkflowResponse,
} from '@dify/contracts/api/console/trial-apps/types.gen'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import useGetRequirements from '../use-get-requirements'

const getWorkflow = vi.hoisted(() => vi.fn(() => new Promise(() => {})))
let workflowData: TrialWorkflowResponse | undefined
const setWorkflowResponse = (response: { data: Pick<TrialWorkflowResponse, 'graph'> | null }) => {
  workflowData = response.data ? { id: 'workflow-1', ...response.data } : undefined
}
function renderHook<T>(callback: () => T) {
  const queryClient = createConsoleQueryClient()
  if (workflowData)
    queryClient.setQueryData(
      consoleQuery.trialApps.byAppId.workflows.get.queryKey({
        input: { params: { app_id: 'test-app-id' } },
      }),
      workflowData,
    )
  return renderHookWithConsoleQuery(callback, { queryClient })
}
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'trialApps.byAppId.workflows.get': getWorkflow,
    }),
  }
})

vi.mock('@/config', () => ({
  MARKETPLACE_API_PREFIX: 'https://marketplace.api',
}))

const createMockAppDetail = (
  mode: string,
  overrides: Partial<TrialAppDetailResponse> = {},
): TrialAppDetailResponse =>
  ({
    id: 'test-app-id',
    name: 'Test App',
    description: 'Test Description',
    mode,
    site: {
      title: 'Test Site Title',
      icon: 'icon',
      icon_type: 'emoji',
      icon_background: '#FFFFFF',
      icon_url: '',
    },
    model_config: {
      model: {
        provider: 'langgenius/openai/openai',
        name: 'gpt-4',
        mode: 'chat',
      },
      dataset_configs: {
        datasets: {
          datasets: [],
        },
      },
      agent_mode: {
        tools: [],
      },
      user_input_form: [],
    },
    ...overrides,
  }) as unknown as TrialAppDetailResponse

describe('useGetRequirements', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('basic app modes (chat, completion, agent-chat)', () => {
    it('returns model provider for chat mode', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('chat')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0]!.name).toBe('openai')
      expect(result.current.requirements[0]!.iconUrl).toBe(
        'https://marketplace.api/plugins/langgenius/openai/icon',
      )
    })

    it('returns model provider for completion mode', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('completion', {
        model_config: {
          model: {
            provider: 'anthropic/claude/claude',
            name: 'claude-3',
            mode: 'completion',
          },
          dataset_configs: { datasets: { datasets: [] } },
          agent_mode: { tools: [] },
          user_input_form: [],
        },
      } as unknown as Partial<TrialAppDetailResponse>)

      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0]!.name).toBe('claude')
    })

    it('returns model provider and tools for agent-chat mode', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('agent-chat', {
        model_config: {
          model: {
            provider: 'langgenius/openai/openai',
            name: 'gpt-4',
            mode: 'chat',
          },
          dataset_configs: { datasets: { datasets: [] } },
          agent_mode: {
            tools: [
              {
                enabled: true,
                provider_id: 'langgenius/google_search/google_search',
                tool_label: 'Google Search',
              },
              {
                enabled: true,
                provider_id: 'langgenius/web_scraper/web_scraper',
                tool_label: 'Web Scraper',
              },
              {
                enabled: false,
                provider_id: 'langgenius/disabled_tool/disabled_tool',
                tool_label: 'Disabled Tool',
              },
            ],
          },
          user_input_form: [],
        },
      } as unknown as Partial<TrialAppDetailResponse>)

      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(3)
      expect(result.current.requirements.map((r) => r.name)).toContain('openai')
      expect(result.current.requirements.map((r) => r.name)).toContain('Google Search')
      expect(result.current.requirements.map((r) => r.name)).toContain('Web Scraper')
      expect(result.current.requirements.map((r) => r.name)).not.toContain('Disabled Tool')
    })

    it('filters out disabled tools in agent mode', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('agent-chat', {
        model_config: {
          model: {
            provider: 'langgenius/openai/openai',
            name: 'gpt-4',
            mode: 'chat',
          },
          dataset_configs: { datasets: { datasets: [] } },
          agent_mode: {
            tools: [
              {
                enabled: false,
                provider_id: 'langgenius/tool1/tool1',
                tool_label: 'Tool 1',
              },
              {
                enabled: false,
                provider_id: 'langgenius/tool2/tool2',
                tool_label: 'Tool 2',
              },
            ],
          },
          user_input_form: [],
        },
      } as unknown as Partial<TrialAppDetailResponse>)

      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0]!.name).toBe('openai')
    })
  })

  describe('advanced app modes (workflow, advanced-chat)', () => {
    it('returns requirements from flow data for workflow mode', () => {
      setWorkflowResponse({
        data: {
          graph: {
            nodes: [
              {
                data: {
                  type: 'llm',
                  model: {
                    provider: 'langgenius/openai/openai',
                    name: 'gpt-4',
                  },
                },
              },
              {
                data: {
                  type: 'tool',
                  provider_id: 'langgenius/google/google',
                  tool_label: 'Google Tool',
                },
              },
            ],
          },
        },
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(2)
      expect(result.current.requirements.map((r) => r.name)).toContain('gpt-4')
      expect(result.current.requirements.map((r) => r.name)).toContain('Google Tool')
    })

    it('returns requirements from flow data for advanced-chat mode', () => {
      setWorkflowResponse({
        data: {
          graph: {
            nodes: [
              {
                data: {
                  type: 'llm',
                  model: {
                    provider: 'anthropic/claude/claude',
                    name: 'claude-3-opus',
                  },
                },
              },
            ],
          },
        },
      })

      const appDetail = createMockAppDetail('advanced-chat')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0]!.name).toBe('claude-3-opus')
    })

    it('returns empty requirements when flow data has no nodes', () => {
      setWorkflowResponse({
        data: {
          graph: {
            nodes: [],
          },
        },
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(0)
    })

    it('returns empty requirements while flow data is pending', () => {
      setWorkflowResponse({
        data: null,
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(0)
    })

    it('extracts multiple LLM nodes from flow data', () => {
      setWorkflowResponse({
        data: {
          graph: {
            nodes: [
              {
                data: {
                  type: 'llm',
                  model: {
                    provider: 'langgenius/openai/openai',
                    name: 'gpt-4',
                  },
                },
              },
              {
                data: {
                  type: 'llm',
                  model: {
                    provider: 'anthropic/claude/claude',
                    name: 'claude-3',
                  },
                },
              },
            ],
          },
        },
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(2)
      expect(result.current.requirements.map((r) => r.name)).toContain('gpt-4')
      expect(result.current.requirements.map((r) => r.name)).toContain('claude-3')
    })

    it('extracts multiple tool nodes from flow data', () => {
      setWorkflowResponse({
        data: {
          graph: {
            nodes: [
              {
                data: {
                  type: 'tool',
                  provider_id: 'langgenius/tool1/tool1',
                  tool_label: 'Tool 1',
                },
              },
              {
                data: {
                  type: 'tool',
                  provider_id: 'langgenius/tool2/tool2',
                  tool_label: 'Tool 2',
                },
              },
            ],
          },
        },
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(2)
      expect(result.current.requirements.map((r) => r.name)).toContain('Tool 1')
      expect(result.current.requirements.map((r) => r.name)).toContain('Tool 2')
    })
  })

  describe('deduplication', () => {
    it('removes duplicate requirements by name', () => {
      setWorkflowResponse({
        data: {
          graph: {
            nodes: [
              {
                data: {
                  type: 'llm',
                  model: {
                    provider: 'langgenius/openai/openai',
                    name: 'gpt-4',
                  },
                },
              },
              {
                data: {
                  type: 'llm',
                  model: {
                    provider: 'langgenius/openai/openai',
                    name: 'gpt-4',
                  },
                },
              },
            ],
          },
        },
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0]!.name).toBe('gpt-4')
    })
  })

  describe('icon URL generation', () => {
    it('generates correct icon URL for model providers', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('chat', {
        model_config: {
          model: {
            provider: 'org/plugin/model',
            name: 'model-name',
            mode: 'chat',
          },
          dataset_configs: { datasets: { datasets: [] } },
          agent_mode: { tools: [] },
          user_input_form: [],
        },
      } as unknown as Partial<TrialAppDetailResponse>)

      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements[0]!.iconUrl).toBe(
        'https://marketplace.api/plugins/org/plugin/icon',
      )
    })

    it('maps google model provider to gemini plugin icon URL', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('chat', {
        model_config: {
          model: {
            provider: 'langgenius/google/google',
            name: 'gemini-2.0',
            mode: 'chat',
          },
          dataset_configs: { datasets: { datasets: [] } },
          agent_mode: { tools: [] },
          user_input_form: [],
        },
      } as unknown as Partial<TrialAppDetailResponse>)

      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(result.current.requirements[0]!.iconUrl).toBe(
        'https://marketplace.api/plugins/langgenius/gemini/icon',
      )
    })

    it('maps special builtin tool providers to *_tool plugin icon URL', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('agent-chat', {
        model_config: {
          model: {
            provider: 'langgenius/openai/openai',
            name: 'gpt-4',
            mode: 'chat',
          },
          dataset_configs: { datasets: { datasets: [] } },
          agent_mode: {
            tools: [
              {
                enabled: true,
                provider_id: 'langgenius/jina/jina',
                tool_label: 'Jina Search',
              },
            ],
          },
          user_input_form: [],
        },
      } as unknown as Partial<TrialAppDetailResponse>)

      const { result } = renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      const toolRequirement = result.current.requirements.find(
        (item) => item.name === 'Jina Search',
      )
      expect(toolRequirement?.iconUrl).toBe(
        'https://marketplace.api/plugins/langgenius/jina_tool/icon',
      )
    })
  })

  describe('hook calls', () => {
    it('does not request workflow data for basic apps', () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('chat')
      renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(getWorkflow).not.toHaveBeenCalled()
    })

    it('requests workflow data for advanced apps', async () => {
      setWorkflowResponse({ data: null })

      const appDetail = createMockAppDetail('workflow')
      renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      await waitFor(() =>
        expect(getWorkflow).toHaveBeenCalledWith({ params: { app_id: 'test-app-id' } }),
      )
    })
  })
})
