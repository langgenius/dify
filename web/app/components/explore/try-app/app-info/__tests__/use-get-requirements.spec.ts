import type { TryAppInfo } from '@/service/try-app'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useGetRequirements from '../use-get-requirements'

const mockUseGetTryAppFlowPreview = vi.fn()

vi.mock('@/service/use-try-app', () => ({
  useGetTryAppFlowPreview: (...args: unknown[]) => mockUseGetTryAppFlowPreview(...args),
}))

vi.mock('@/config', () => ({
  MARKETPLACE_API_PREFIX: 'https://marketplace.api',
}))

const createMockAppDetail = (mode: string, overrides: Partial<TryAppInfo> = {}): TryAppInfo => ({
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
} as unknown as TryAppInfo)

describe('useGetRequirements', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('basic app modes (chat, completion, agent-chat)', () => {
    it('returns model provider for chat mode', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

      const appDetail = createMockAppDetail('chat')
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0].name).toBe('openai')
      expect(result.current.requirements[0].iconUrl).toBe('https://marketplace.api/plugins/langgenius/openai/icon')
    })

    it('returns model provider for completion mode', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

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
      } as unknown as Partial<TryAppInfo>)

      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0].name).toBe('claude')
    })

    it('returns model provider and tools for agent-chat mode', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

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
      } as unknown as Partial<TryAppInfo>)

      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(3)
      expect(result.current.requirements.map(r => r.name)).toContain('openai')
      expect(result.current.requirements.map(r => r.name)).toContain('Google Search')
      expect(result.current.requirements.map(r => r.name)).toContain('Web Scraper')
      expect(result.current.requirements.map(r => r.name)).not.toContain('Disabled Tool')
    })

    it('filters out disabled tools in agent mode', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

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
      } as unknown as Partial<TryAppInfo>)

      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0].name).toBe('openai')
    })
  })

  describe('advanced app modes (workflow, advanced-chat)', () => {
    it('returns requirements from flow data for workflow mode', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
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
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(2)
      expect(result.current.requirements.map(r => r.name)).toContain('gpt-4')
      expect(result.current.requirements.map(r => r.name)).toContain('Google Tool')
    })

    it('returns requirements from flow data for advanced-chat mode', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
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
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0].name).toBe('claude-3-opus')
    })

    it('returns empty requirements when flow data has no nodes', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: {
          graph: {
            nodes: [],
          },
        },
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(0)
    })

    it('returns empty requirements when flow data is null', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
        data: null,
      })

      const appDetail = createMockAppDetail('workflow')
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(0)
    })

    it('extracts multiple LLM nodes from flow data', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
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
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(2)
      expect(result.current.requirements.map(r => r.name)).toContain('gpt-4')
      expect(result.current.requirements.map(r => r.name)).toContain('claude-3')
    })

    it('extracts multiple tool nodes from flow data', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
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
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(2)
      expect(result.current.requirements.map(r => r.name)).toContain('Tool 1')
      expect(result.current.requirements.map(r => r.name)).toContain('Tool 2')
    })
  })

  describe('deduplication', () => {
    it('removes duplicate requirements by name', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({
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
      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements).toHaveLength(1)
      expect(result.current.requirements[0].name).toBe('gpt-4')
    })
  })

  describe('icon URL generation', () => {
    it('generates correct icon URL for model providers', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

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
      } as unknown as Partial<TryAppInfo>)

      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements[0].iconUrl).toBe('https://marketplace.api/plugins/org/plugin/icon')
    })

    it('maps google model provider to gemini plugin icon URL', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

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
      } as unknown as Partial<TryAppInfo>)

      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      expect(result.current.requirements[0].iconUrl).toBe('https://marketplace.api/plugins/langgenius/gemini/icon')
    })

    it('maps special builtin tool providers to *_tool plugin icon URL', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

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
      } as unknown as Partial<TryAppInfo>)

      const { result } = renderHook(() =>
        useGetRequirements({ appDetail, appId: 'test-app-id' }),
      )

      const toolRequirement = result.current.requirements.find(item => item.name === 'Jina Search')
      expect(toolRequirement?.iconUrl).toBe('https://marketplace.api/plugins/langgenius/jina_tool/icon')
    })
  })

  describe('hook calls', () => {
    it('calls useGetTryAppFlowPreview with correct parameters for basic apps', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

      const appDetail = createMockAppDetail('chat')
      renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(mockUseGetTryAppFlowPreview).toHaveBeenCalledWith('test-app-id', true)
    })

    it('calls useGetTryAppFlowPreview with correct parameters for advanced apps', () => {
      mockUseGetTryAppFlowPreview.mockReturnValue({ data: null })

      const appDetail = createMockAppDetail('workflow')
      renderHook(() => useGetRequirements({ appDetail, appId: 'test-app-id' }))

      expect(mockUseGetTryAppFlowPreview).toHaveBeenCalledWith('test-app-id', false)
    })
  })
})
