import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { PromptItem, Node as WorkflowNode } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, EditionType, PromptRole, VarType } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import {
  buildAssembleNestedNodeConfig,
  buildAssemblePlaceholder,
  buildPromptTemplateWithText,
  getDefaultOutputKey,
  getUserPromptText,
  hasUserPromptTemplate,
  resolvePromptText,
  useMixedVariableExtractor,
} from '../use-mixed-variable-extractor'

const {
  mockFetchNestedNodeGraph,
  mockGenerateNewNode,
  mockGetNodeCustomTypeByNodeDataType,
  mockMergeNodeDefaultData,
  mockToastError,
} = vi.hoisted(() => ({
  mockFetchNestedNodeGraph: vi.fn(),
  mockGenerateNewNode: vi.fn(),
  mockGetNodeCustomTypeByNodeDataType: vi.fn(),
  mockMergeNodeDefaultData: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/app/components/workflow/utils', () => ({
  generateNewNode: (...args: unknown[]) => mockGenerateNewNode(...args),
  getNodeCustomTypeByNodeDataType: (...args: unknown[]) => mockGetNodeCustomTypeByNodeDataType(...args),
  mergeNodeDefaultData: (...args: unknown[]) => mockMergeNodeDefaultData(...args),
}))

vi.mock('@/service/workflow', () => ({
  fetchNestedNodeGraph: (...args: unknown[]) => mockFetchNestedNodeGraph(...args),
}))

type MutableStoreState = {
  nodes: WorkflowNode[]
}

type MockReactFlowStore = {
  getState: () => {
    getNodes: () => WorkflowNode[]
    setNodes: (nextNodes: WorkflowNode[]) => void
  }
}

const createReactFlowStore = (initialNodes: WorkflowNode[]) => {
  const state: MutableStoreState = {
    nodes: [...initialNodes],
  }

  return {
    state,
    api: {
      getState: () => ({
        getNodes: () => state.nodes,
        setNodes: (nextNodes: WorkflowNode[]) => {
          state.nodes = nextNodes
        },
      }),
    },
  }
}

const buildUserPrompt = (text: string): PromptItem => ({
  role: PromptRole.user,
  text,
})

describe('useMixedVariableExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetNodeCustomTypeByNodeDataType.mockReturnValue('custom-tool-node')
    mockMergeNodeDefaultData.mockImplementation(({ metaDefault, appDefault, overrideData }) => ({
      ...metaDefault,
      ...appDefault,
      ...overrideData,
    }))
    mockGenerateNewNode.mockImplementation(({ id, type, data, position, hidden }) => ({
      newNode: {
        id,
        type,
        data,
        position,
        hidden,
      },
    }))
  })

  it('should normalize prompt templates through the exported helper functions', () => {
    expect(resolvePromptText()).toBe('')
    expect(resolvePromptText({
      role: PromptRole.user,
      text: 'plain text',
    })).toBe('plain text')
    expect(resolvePromptText({
      role: PromptRole.user,
      text: '',
    })).toBe('')
    expect(resolvePromptText({
      role: PromptRole.user,
      text: 'fallback text',
      jinja2_text: 'jinja text',
      edition_type: EditionType.jinja2,
    })).toBe('jinja text')
    expect(resolvePromptText({
      role: PromptRole.user,
      text: 'fallback text',
      jinja2_text: '',
      edition_type: EditionType.jinja2,
    })).toBe('fallback text')
    expect(resolvePromptText({
      role: PromptRole.user,
      text: '',
      jinja2_text: '',
      edition_type: EditionType.jinja2,
    })).toBe('')

    expect(getUserPromptText()).toBe('')
    expect(getUserPromptText({
      role: PromptRole.user,
      text: 'single prompt',
    })).toBe('single prompt')
    expect(getUserPromptText([
      { role: PromptRole.assistant, text: 'assistant' },
    ] as PromptItem[])).toBe('')
    expect(getUserPromptText([
      { role: PromptRole.assistant, text: 'assistant' },
      { role: PromptRole.user, text: 'user prompt' },
    ] as PromptItem[])).toBe('user prompt')

    expect(hasUserPromptTemplate({ role: PromptRole.user, text: 'single prompt' })).toBe(true)
    expect(hasUserPromptTemplate([
      { role: PromptRole.assistant, text: 'assistant' },
    ] as PromptItem[])).toBe(false)

    expect(buildPromptTemplateWithText({
      role: PromptRole.user,
      text: 'before',
    }, 'after')).toEqual({
      role: PromptRole.user,
      text: 'after',
    })
    expect(buildPromptTemplateWithText({
      role: PromptRole.user,
      text: 'before',
      edition_type: EditionType.jinja2,
      jinja2_text: 'before',
    }, 'after')).toEqual({
      role: PromptRole.user,
      text: 'after',
      edition_type: EditionType.jinja2,
      jinja2_text: 'after',
    })
    expect(buildPromptTemplateWithText([
      { role: PromptRole.user, text: 'before' },
      { role: PromptRole.assistant, text: 'assistant' },
    ] as PromptItem[], 'after')).toEqual([
      { role: PromptRole.user, text: 'after' },
      { role: PromptRole.assistant, text: 'assistant' },
    ])
    expect(buildPromptTemplateWithText([
      {
        role: PromptRole.assistant,
        text: 'assistant',
        edition_type: EditionType.jinja2,
      },
    ] as PromptItem[], 'appended')).toEqual([
      {
        role: PromptRole.assistant,
        text: 'assistant',
        edition_type: EditionType.jinja2,
      },
      {
        role: PromptRole.user,
        text: 'appended',
        jinja2_text: 'appended',
        edition_type: EditionType.jinja2,
      },
    ])
    expect(buildPromptTemplateWithText([
      { role: PromptRole.assistant, text: 'assistant' },
    ] as PromptItem[], 'plain appended')).toEqual([
      { role: PromptRole.assistant, text: 'assistant' },
      { role: PromptRole.user, text: 'plain appended' },
    ])
  })

  it('should build assemble placeholders and default nested configs', () => {
    expect(buildAssemblePlaceholder()).toBe('')
    expect(buildAssemblePlaceholder('tool-node', 'query')).toBe('{{#tool-node_ext_query.result#}}')
    expect(getDefaultOutputKey()).toBe('')
    expect(getDefaultOutputKey({})).toBe('')
    expect(getDefaultOutputKey({
      fallback: {
        type: VarType.string,
        children: null,
      },
    })).toBe('fallback')
    expect(getDefaultOutputKey({
      fallback: {
        type: VarType.string,
        children: null,
      },
      result: {
        type: VarType.string,
        children: null,
      },
    })).toBe('result')
    expect(buildAssembleNestedNodeConfig('tool-node_ext_query', {
      result: {
        type: VarType.string,
        children: null,
      },
    })).toEqual({
      extractor_node_id: 'tool-node_ext_query',
      output_selector: ['result'],
      null_strategy: NULL_STRATEGY.RAISE_ERROR,
      default_value: '',
    })
    expect(buildAssembleNestedNodeConfig('tool-node_ext_query')).toEqual({
      extractor_node_id: 'tool-node_ext_query',
      output_selector: [],
      null_strategy: NULL_STRATEGY.RAISE_ERROR,
      default_value: '',
    })
  })

  it('should create and normalize the assemble extractor node', () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([])

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.Code]: {
          defaultValue: { title: 'Code Extractor' } as Partial<CodeNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.Code]: {
          outputs: {},
        } as Partial<CodeNodeType>,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    }))

    act(() => {
      result.current.ensureAssembleExtractorNode()
    })

    expect(state.nodes).toHaveLength(1)
    expect(state.nodes[0].id).toBe('tool-node_ext_query')
    expect((state.nodes[0].data as CodeNodeType).outputs).toEqual({
      result: {
        type: VarType.string,
        children: null,
      },
    })
    expect(handleSyncWorkflowDraft).toHaveBeenCalled()
  })

  it('should sync the extractor prompt with the text after the agent placeholder', () => {
    const extractorNode: WorkflowNode<LLMNodeType> = {
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [buildUserPrompt('old prompt')],
      },
    } as WorkflowNode<LLMNodeType>
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([extractorNode])

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    }))

    act(() => {
      result.current.syncExtractorPromptFromText('{{@agent-1.context@}}new prompt', () => ({
        nodeId: 'agent-1',
        name: 'Agent One',
      }))
    })

    expect(((state.nodes[0].data as LLMNodeType).prompt_template as PromptItem[])[0].text).toBe('new prompt')
    expect(handleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('should no-op when extractor defaults are unavailable and replace mismatched extractor nodes', () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
      },
    } as unknown as WorkflowNode])

    const { result, rerender } = renderHook((props: Parameters<typeof useMixedVariableExtractor>[0]) => useMixedVariableExtractor(props), {
      initialProps: {
        toolNodeId: '',
        paramKey: 'query',
        language: 'en_US',
        nodesById: {},
        reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
        handleSyncWorkflowDraft,
      } as Parameters<typeof useMixedVariableExtractor>[0],
    })

    expect(result.current.ensureExtractorNode({
      extractorNodeId: 'tool-node_ext_query',
      nodeType: BlockEnum.LLM,
      data: {},
    })).toBeNull()

    rerender({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.LLM]: {
          defaultValue: { title: 'LLM Extractor' } as Partial<LLMNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.LLM]: { prompt_template: [buildUserPrompt('seed')] } as Partial<LLMNodeType>,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    } as Parameters<typeof useMixedVariableExtractor>[0])

    act(() => {
      result.current.ensureExtractorNode({
        extractorNodeId: 'tool-node_ext_query',
        nodeType: BlockEnum.LLM,
        data: {
          structured_output_enabled: true,
        },
      })
    })

    expect(state.nodes[0].data.type).toBe(BlockEnum.LLM)
    expect(handleSyncWorkflowDraft).toHaveBeenCalled()
  })

  it('should update existing assemble extractor outputs and remove extractor nodes when requested', () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
        outputs: {
          fallback: {
            type: VarType.number,
            children: null,
          },
        },
      },
    } as unknown as WorkflowNode])

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.Code]: {
          defaultValue: { title: 'Code Extractor' } as Partial<CodeNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.Code]: { outputs: {} } as Partial<CodeNodeType>,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    }))

    act(() => {
      result.current.ensureAssembleExtractorNode()
    })

    expect((state.nodes[0].data as CodeNodeType).outputs).toEqual({
      fallback: {
        type: VarType.number,
        children: null,
      },
      result: {
        type: VarType.string,
        children: null,
      },
    })

    act(() => {
      result.current.removeExtractorNode()
    })

    expect(state.nodes).toEqual([])
  })

  it('should update jinja prompt templates and ignore prompt sync when no agent is detected', () => {
    const extractorNode: WorkflowNode<LLMNodeType> = {
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [{
          role: PromptRole.assistant,
          text: 'assistant-only',
          edition_type: EditionType.jinja2,
        }],
      },
    } as WorkflowNode<LLMNodeType>
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([extractorNode])

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    }))

    act(() => {
      result.current.syncExtractorPromptFromText('no agent placeholder', () => null)
    })

    expect(handleSyncWorkflowDraft).not.toHaveBeenCalled()

    act(() => {
      result.current.syncExtractorPromptFromText('{{@agent-1.context@}}jinja prompt', () => ({
        nodeId: 'agent-1',
        name: 'Agent One',
      }))
    })

    const promptTemplate = (state.nodes[0].data as LLMNodeType).prompt_template as PromptItem[]
    expect(promptTemplate).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: PromptRole.user,
        text: 'jinja prompt',
        jinja2_text: 'jinja prompt',
        edition_type: EditionType.jinja2,
      }),
    ]))
  })

  it('should request nested node graph data and merge it into the extractor node', async () => {
    const extractorNode: WorkflowNode<LLMNodeType> = {
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [buildUserPrompt('old prompt')],
      },
    } as WorkflowNode<LLMNodeType>
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([extractorNode])

    mockFetchNestedNodeGraph.mockResolvedValue({
      graph: {
        nodes: [{
          id: 'tool-node_ext_query',
          data: {
            title: 'Context Extractor',
            model: {
              provider: 'anthropic',
              name: 'claude-3-7-sonnet',
            },
            prompt_template: [buildUserPrompt('seed prompt')],
            structured_output_enabled: true,
            structured_output: {
              schema: {
                type: Type.object,
              },
            },
            computer_use: false,
          },
        }],
      },
    })

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {
        'tool-node': {
          id: 'tool-node',
          data: {
            paramSchemas: [{
              name: 'query',
              type: Type.string,
              llm_description: 'Query string',
              human_description: { en_US: 'Query string' },
            }],
          },
        } as unknown as WorkflowNode,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      },
    }))

    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}final prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(mockFetchNestedNodeGraph).toHaveBeenCalledWith(FlowType.appFlow, 'flow-1', {
      parent_node_id: 'tool-node',
      parameter_key: 'query',
      context_source: ['agent-1', 'context'],
      parameter_schema: {
        name: 'query',
        type: Type.string,
        description: 'Query string',
      },
    })
    expect((state.nodes[0].data as LLMNodeType).title).toBe('Context Extractor')
    expect((state.nodes[0].data as LLMNodeType).model).toEqual({
      provider: 'anthropic',
      name: 'claude-3-7-sonnet',
    })
    expect(((state.nodes[0].data as LLMNodeType).prompt_template as PromptItem[])[0].text).toBe('final prompt')
    expect(handleSyncWorkflowDraft).toHaveBeenCalled()
  })

  it('should skip nested graph requests outside app flow and toast on request failures', async () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { api } = createReactFlowStore([])

    const { result, rerender } = renderHook((props: Parameters<typeof useMixedVariableExtractor>[0]) => useMixedVariableExtractor(props), {
      initialProps: {
        toolNodeId: 'tool-node',
        paramKey: 'query',
        language: 'en_US',
        nodesById: {},
        reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
        handleSyncWorkflowDraft,
        configsMap: {
          flowId: 'flow-1',
          flowType: FlowType.ragPipeline,
        },
      },
    })

    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(mockFetchNestedNodeGraph).not.toHaveBeenCalled()

    mockFetchNestedNodeGraph.mockRejectedValueOnce(new Error('request failed'))

    rerender({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      },
    })

    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(mockToastError).toHaveBeenCalledWith('request failed')
  })

  it('should return existing nodes, skip missing removals, and ignore empty nested graph payloads', async () => {
    const handleSyncWorkflowDraft = vi.fn()
    const existingNode = {
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [buildUserPrompt('same prompt')],
      },
    } as WorkflowNode<LLMNodeType>
    const { state, api } = createReactFlowStore([existingNode])

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.LLM]: {
          defaultValue: { title: 'LLM Extractor' } as Partial<LLMNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.LLM]: { prompt_template: [buildUserPrompt('seed')] } as Partial<LLMNodeType>,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      },
    }))

    expect(result.current.ensureExtractorNode({
      extractorNodeId: 'tool-node_ext_query',
      nodeType: BlockEnum.LLM,
      data: {},
    })).toBe(existingNode)

    act(() => {
      result.current.removeExtractorNode()
    })

    expect(state.nodes).toEqual([])
    handleSyncWorkflowDraft.mockClear()

    mockFetchNestedNodeGraph.mockResolvedValueOnce({
      graph: {
        nodes: [{
          id: 'tool-node_ext_query',
          data: {},
        }],
      },
    })

    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}same prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(handleSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should early-return for missing ids, missing defaults, missing prompt templates, and missing extractor nodes', async () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
      },
    } as unknown as WorkflowNode])

    const { result, rerender } = renderHook((props: Parameters<typeof useMixedVariableExtractor>[0]) => useMixedVariableExtractor(props), {
      initialProps: {
        toolNodeId: '',
        paramKey: '',
        language: 'en_US',
        nodesById: {},
        reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
        handleSyncWorkflowDraft,
        configsMap: {
          flowId: 'flow-1',
          flowType: FlowType.appFlow,
        },
      },
    })

    expect(result.current.ensureAssembleExtractorNode()).toBe('')
    act(() => {
      result.current.removeExtractorNode()
      result.current.syncExtractorPromptFromText('{{@agent-1.context@}}prompt', () => ({
        nodeId: 'agent-1',
        name: 'Agent One',
      }))
    })

    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(mockFetchNestedNodeGraph).not.toHaveBeenCalled()

    rerender({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      },
    })

    expect(result.current.ensureAssembleExtractorNode()).toBe('')
    act(() => {
      result.current.syncExtractorPromptFromText('{{@agent-1.context@}}prompt', () => ({
        nodeId: 'agent-1',
        name: 'Agent One',
      }))
      result.current.removeExtractorNode()
      result.current.removeExtractorNode()
    })
    handleSyncWorkflowDraft.mockClear()

    expect(result.current.ensureExtractorNode({
      extractorNodeId: 'tool-node_ext_query',
      nodeType: BlockEnum.LLM,
      data: {},
    })).toBeNull()

    mockFetchNestedNodeGraph.mockResolvedValueOnce({ graph: { nodes: [] } })
    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(handleSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(state.nodes).toHaveLength(0)
  })

  it('should backfill missing outputs for code assemble extractors and use metadata title fallbacks when defaults are sparse', () => {
    const handleSyncWorkflowDraft = vi.fn()
    const fallbackStore = createReactFlowStore([])
    mockMergeNodeDefaultData.mockImplementationOnce(({ overrideData }) => ({
      ...overrideData,
    }))

    const { result: fallbackResult } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.Code]: {
          defaultValue: { title: 'Meta Title' } as Partial<CodeNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.Code]: { title: 'App Title' } as Partial<CodeNodeType>,
      },
      reactFlowStore: fallbackStore.api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    }))

    fallbackResult.current.ensureExtractorNode({
      extractorNodeId: 'fallback-extractor',
      nodeType: BlockEnum.Code,
      data: {},
    })
    expect((fallbackStore.state.nodes[0].data as CodeNodeType).title).toBe('Meta Title')

    const codeStore = createReactFlowStore([
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
        },
      } as WorkflowNode<CodeNodeType>,
      {
        id: 'other-node',
        data: {
          type: BlockEnum.Code,
        },
      } as WorkflowNode,
    ])

    const { result: codeResult } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.Code]: {
          defaultValue: { title: 'Code Extractor' } as Partial<CodeNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.Code]: {} as Partial<CodeNodeType>,
      },
      reactFlowStore: codeStore.api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
    }))

    expect(codeResult.current.ensureAssembleExtractorNode()).toBe('tool-node_ext_query')
    expect((codeStore.state.nodes[0].data as CodeNodeType).outputs).toEqual({
      result: {
        type: VarType.string,
        children: null,
      },
    })
    expect(codeStore.state.nodes[1].id).toBe('other-node')
  })

  it('should merge desc, context, vision, memory, and plain schema fallbacks from nested graph data', async () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [buildUserPrompt('seed')],
      },
    } as unknown as WorkflowNode])

    mockFetchNestedNodeGraph.mockResolvedValueOnce({
      graph: {
        nodes: [{
          id: 'tool-node_ext_query',
          data: {
            title: 'Extractor',
            desc: 'Description',
            model: {
              provider: '',
              name: 'claude-3-7-sonnet',
            },
            prompt_template: undefined,
            structured_output_enabled: false,
            structured_output: undefined,
            computer_use: true,
            context: {
              enabled: true,
            },
            vision: {
              enabled: true,
            },
            memory: {
              enabled: false,
            },
          },
        }],
      },
    })

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {
        'tool-node': {
          id: 'tool-node',
          data: {
            paramSchemas: [],
          },
        } as unknown as WorkflowNode,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      },
    }))

    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'tool-node_ext_query',
        valueText: '{{@agent-1.context@}}seed',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect((state.nodes[0].data as LLMNodeType)).toEqual(expect.objectContaining({
      title: 'Extractor',
      desc: 'Description',
      context: { enabled: true },
      vision: { enabled: true },
      memory: { enabled: false },
      computer_use: true,
    }))
  })

  it('should use default title fallbacks and handle string-based nested graph failures', async () => {
    const handleSyncWorkflowDraft = vi.fn()
    const { state, api } = createReactFlowStore([
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            fallback: {
              type: VarType.number,
              children: null,
            },
          },
        },
      } as unknown as WorkflowNode,
      {
        id: 'other-node',
        data: {
          type: BlockEnum.Code,
        },
      } as unknown as WorkflowNode,
    ])

    const { result } = renderHook(() => useMixedVariableExtractor({
      toolNodeId: 'tool-node',
      paramKey: 'query',
      language: 'en_US',
      nodesById: {},
      nodesMetaDataMap: {
        [BlockEnum.LLM]: {
          defaultValue: { title: 'meta-title', desc: 'meta-desc' } as Partial<LLMNodeType>,
          checkValid: vi.fn(),
        },
        [BlockEnum.Code]: {
          defaultValue: { title: 'code-title' } as Partial<CodeNodeType>,
          checkValid: vi.fn(),
        },
      } as unknown as Parameters<typeof useMixedVariableExtractor>[0]['nodesMetaDataMap'],
      nodesDefaultConfigs: {
        [BlockEnum.LLM]: { title: 'app-title', desc: 'app-desc' } as Partial<LLMNodeType>,
        [BlockEnum.Code]: { outputs: {} } as Partial<CodeNodeType>,
      },
      reactFlowStore: api as unknown as MockReactFlowStore as Parameters<typeof useMixedVariableExtractor>[0]['reactFlowStore'],
      handleSyncWorkflowDraft,
      configsMap: {
        flowId: 'flow-1',
        flowType: FlowType.appFlow,
      },
    }))

    act(() => {
      result.current.ensureExtractorNode({
        extractorNodeId: 'new-extractor',
        nodeType: BlockEnum.LLM,
        data: {},
      })
      result.current.ensureAssembleExtractorNode()
    })

    expect(state.nodes.find(node => node.id === 'new-extractor')?.data).toEqual(expect.objectContaining({
      title: 'app-title',
      desc: 'app-desc',
    }))
    expect((state.nodes.find(node => node.id === 'tool-node_ext_query')?.data as CodeNodeType).outputs).toEqual({
      fallback: {
        type: VarType.number,
        children: null,
      },
      result: {
        type: VarType.string,
        children: null,
      },
    })

    mockFetchNestedNodeGraph.mockRejectedValueOnce('string failure')
    await act(async () => {
      await result.current.requestNestedNodeGraph({
        agentId: 'agent-1',
        extractorNodeId: 'missing-extractor',
        valueText: '{{@agent-1.context@}}prompt',
        detectAgentFromText: () => ({
          nodeId: 'agent-1',
          name: 'Agent One',
        }),
      })
    })

    expect(mockToastError).toHaveBeenCalledWith('string failure')
  })
})
