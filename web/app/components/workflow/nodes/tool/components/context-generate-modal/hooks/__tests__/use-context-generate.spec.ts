import type { ToolParameter } from '@/app/components/tools/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useContextGenerate, {
  buildValueSelector,
  mapCodeNodeOutputs,
  mapCodeNodeVariables,
  normalizeCodeLanguage,
  resolveVarSchema,
  toAvailableVarsPayload,
} from '../use-context-generate'

const {
  mockFetchContextGenerateSuggestedQuestions,
  mockGenerateContext,
  mockStorageGet,
  mockStorageSet,
  mockToastError,
  mockDefaultModelState,
  mockAvailableVarHookState,
  mockWorkflowNodesState,
  mockLocaleState,
} = vi.hoisted(() => ({
  mockFetchContextGenerateSuggestedQuestions: vi.fn(),
  mockGenerateContext: vi.fn(),
  mockStorageGet: vi.fn(),
  mockStorageSet: vi.fn(),
  mockToastError: vi.fn(),
  mockDefaultModelState: {
    value: {
      model: 'gpt-4o',
      provider: {
        provider: 'openai',
      },
    },
  } as {
    value: {
      model: string
      provider: {
        provider: string
      }
    } | null
  },
  mockAvailableVarHookState: {
    value: {
      availableVars: [] as NodeOutPutVar[],
      availableNodesWithParent: [] as Node[],
    },
  },
  mockWorkflowNodesState: {
    value: [] as Array<{ id: string, data: { paramSchemas?: ToolParameter[] } }>,
  },
  mockLocaleState: {
    value: 'en_US',
  },
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: mockDefaultModelState.value,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (_toolNodeId: string, options?: { filterVar?: (value: unknown) => boolean }) => {
    options?.filterVar?.({})
    return mockAvailableVarHookState.value
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodes: Array<{ id: string, data: { paramSchemas?: ToolParameter[] } }> }) => unknown) =>
    selector({
      nodes: mockWorkflowNodesState.value,
    }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => mockLocaleState.value,
}))

vi.mock('@/service/debug', async () => {
  const actual = await vi.importActual<typeof import('@/service/debug')>('@/service/debug')
  return {
    ...actual,
    fetchContextGenerateSuggestedQuestions: (...args: unknown[]) => mockFetchContextGenerateSuggestedQuestions(...args),
    generateContext: (...args: unknown[]) => mockGenerateContext(...args),
  }
})

vi.mock('@/utils/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
  },
}))

const availableVars: NodeOutPutVar[] = [{
  nodeId: 'start-node',
  title: 'Start',
  vars: [{
    variable: 'result',
    type: VarType.string,
    children: undefined,
  }],
}]

const availableNodes: Node[] = [{
  id: 'start-node',
  position: { x: 0, y: 0 },
  data: {
    title: 'Start',
    type: 'start',
  },
} as unknown as Node]

const codeNodeData = {
  title: 'Context Extractor',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.python3,
  code: 'print(result)',
  outputs: {
    result: {
      type: VarType.string,
      children: null,
    },
  },
  variables: [{
    variable: 'result',
    value_selector: ['result'],
  }],
} as unknown as CodeNodeType

const buildCodeNodeData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  ...codeNodeData,
  ...overrides,
}) as CodeNodeType

describe('useContextGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockDefaultModelState.value = {
      model: 'gpt-4o',
      provider: {
        provider: 'openai',
      },
    }
    mockAvailableVarHookState.value = {
      availableVars: [],
      availableNodesWithParent: [],
    }
    mockWorkflowNodesState.value = [{
      id: 'tool-node',
      data: {
        paramSchemas: [{
          name: 'query',
          type: 'string',
          required: true,
          llm_description: 'Query string',
          human_description: { en_US: 'Query string' },
          label: { en_US: 'Query' },
        } as ToolParameter],
      },
    }]
    mockLocaleState.value = 'en_US'
    mockStorageGet.mockReturnValue(null)
    mockFetchContextGenerateSuggestedQuestions.mockImplementation((_payload, registerAbort?: (abortController: AbortController) => void) => {
      const controller = new AbortController()
      registerAbort?.(controller)
      return Promise.resolve({
        questions: ['How do I validate the payload?'],
      })
    })
    mockGenerateContext.mockResolvedValue({
      variables: [{ variable: 'result', value_selector: ['result'] }],
      outputs: { result: { type: 'string' } },
      code_language: CodeLanguage.javascript,
      code: 'return result',
      message: 'Generated version',
      error: '',
    })
  })

  it('should normalize helper inputs used by the hook payload builders', () => {
    expect(normalizeCodeLanguage('javascript')).toBe(CodeLanguage.javascript)
    expect(normalizeCodeLanguage('unknown')).toBe(CodeLanguage.python3)

    expect(buildValueSelector('', {
      variable: 'foo.bar',
      type: VarType.string,
      children: undefined,
    })).toEqual(['foo', 'bar'])
    expect(buildValueSelector('start-node', {
      variable: 'sys.query',
      type: VarType.string,
      children: undefined,
    })).toEqual(['sys', 'query'])
    expect(buildValueSelector('node-1', {
      variable: 'result',
      type: VarType.string,
      children: undefined,
    })).toEqual(['node-1', 'result'])
    expect(buildValueSelector('node-1', {
      variable: 'retrieval.docs',
      type: VarType.string,
      children: undefined,
      isRagVariable: true,
    } as Parameters<typeof buildValueSelector>[1])).toEqual(['retrieval', 'docs'])

    expect(resolveVarSchema({
      variable: 'plain',
      type: VarType.string,
      children: undefined,
    })).toBeUndefined()
    expect(resolveVarSchema({
      variable: 'array',
      type: VarType.arrayObject,
      children: [],
    } as Parameters<typeof resolveVarSchema>[0])).toBeUndefined()
    expect(resolveVarSchema({
      variable: 'missing-schema',
      type: VarType.object,
      children: {},
    } as Parameters<typeof resolveVarSchema>[0])).toBeUndefined()
    expect(resolveVarSchema({
      variable: 'invalid-schema',
      type: VarType.object,
      children: { schema: '{bad json' },
    } as Parameters<typeof resolveVarSchema>[0])).toBeUndefined()
    expect(resolveVarSchema({
      variable: 'null-schema',
      type: VarType.object,
      children: { schema: null },
    } as unknown as Parameters<typeof resolveVarSchema>[0])).toBeUndefined()
    expect(resolveVarSchema({
      variable: 'string-schema',
      type: VarType.object,
      children: { schema: '{"type":"object"}' },
    } as Parameters<typeof resolveVarSchema>[0])).toEqual({ type: 'object' })
    expect(resolveVarSchema({
      variable: 'object-schema',
      type: VarType.object,
      children: { schema: { type: 'array' } },
    } as Parameters<typeof resolveVarSchema>[0])).toEqual({ type: 'array' })

    expect(mapCodeNodeOutputs()).toBeUndefined()
    expect(mapCodeNodeOutputs({
      firstOnly: null as unknown as { type: string },
    })).toBeUndefined()
    expect(mapCodeNodeOutputs({
      first: { type: 'string' },
      second: null as unknown as { type: string },
    })).toEqual({ first: { type: 'string' } })
    expect(mapCodeNodeVariables()).toBeUndefined()
    expect(mapCodeNodeVariables([
      { variable: 'foo', value_selector: null },
      { variable: 'bar', value_selector: ['bar'] },
    ])).toEqual([
      { variable: 'foo', value_selector: [] },
      { variable: 'bar', value_selector: ['bar'] },
    ])
  })

  it('should build available var payloads from node metadata and descriptions', () => {
    const payload = toAvailableVarsPayload([{
      nodeId: 'node-1',
      title: 'Node 1',
      vars: [
        {
          variable: 'result',
          type: VarType.string,
          children: { schema: '{"type":"string"}' },
          des: 'legacy description',
        } as NodeOutPutVar['vars'][number],
        {
          variable: 'custom',
          type: VarType.string,
          children: undefined,
          description: 'new description',
        } as NodeOutPutVar['vars'][number],
      ],
    }], new Map([
      ['node-1', { id: 'node-1', data: { type: BlockEnum.Code } } as Node],
    ]))

    expect(payload).toEqual([
      expect.objectContaining({
        value_selector: ['node-1', 'result'],
        description: 'legacy description',
        schema: { type: 'string' },
        node_type: BlockEnum.Code,
      }),
      expect.objectContaining({
        value_selector: ['node-1', 'custom'],
        description: 'new description',
      }),
    ])
  })

  it('should fetch suggested questions once and allow aborting the request controller', async () => {
    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions()
    })

    await waitFor(() => {
      expect(result.current.suggestedQuestions).toEqual(['How do I validate the payload?'])
      expect(result.current.hasFetchedSuggestions).toBe(true)
    })

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions()
    })

    expect(mockFetchContextGenerateSuggestedQuestions).toHaveBeenCalledTimes(1)

    expect(() => {
      result.current.abortSuggestedQuestions()
    }).not.toThrow()
  })

  it('should append prompt messages and create a new generated version', async () => {
    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    act(() => {
      result.current.setInputValue('Generate a better context extractor')
    })

    await act(async () => {
      await result.current.handleGenerate()
    })

    await waitFor(() => {
      expect(result.current.promptMessages).toHaveLength(2)
      expect(result.current.promptMessages[0].content).toBe('Generate a better context extractor')
      expect(result.current.promptMessages[1].content).toBe('Generated version')
      expect(result.current.versions).toHaveLength(1)
      expect(result.current.current?.code).toBe('return result')
    })
  })

  it('should persist model overrides when the selected model or params change', () => {
    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    act(() => {
      result.current.handleModelChange({
        modelId: 'claude-3-7-sonnet',
        provider: 'anthropic',
        mode: Type.string,
      })
    })

    act(() => {
      result.current.handleCompletionParamsChange({
        temperature: 0.2,
      })
    })

    expect(mockStorageSet).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({
      provider: 'anthropic',
      name: 'claude-3-7-sonnet',
    }))
    expect(mockStorageSet).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      completion_params: {
        temperature: 0.2,
      },
    }))
    expect(result.current.model.provider).toBe('anthropic')
  })

  it('should derive available vars and prefer the stored model override when explicit values are absent', () => {
    mockStorageGet.mockReturnValue({
      provider: 'anthropic',
      name: 'claude-3-7-sonnet',
      mode: 'chat',
      completion_params: {
        temperature: 0.1,
      },
    })
    mockAvailableVarHookState.value = {
      availableVars,
      availableNodesWithParent: availableNodes,
    }

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
    }))

    expect(result.current.model).toEqual(expect.objectContaining({
      provider: 'anthropic',
      name: 'claude-3-7-sonnet',
      completion_params: {
        temperature: 0.1,
      },
    }))
    expect(result.current.availableVars).toEqual(availableVars)
    expect(result.current.availableNodes).toEqual(availableNodes)
    expect(result.current.currentVersionLabel).toBe('appDebug.generate.version 1')
  })

  it('should skip fetching suggestions when ids or model configuration are missing', async () => {
    const { result: missingIdsResult } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: '',
      paramKey: '',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await missingIdsResult.current.handleFetchSuggestedQuestions()
    })

    expect(mockFetchContextGenerateSuggestedQuestions).not.toHaveBeenCalled()

    mockDefaultModelState.value = null
    const { result: missingModelResult } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await missingModelResult.current.handleFetchSuggestedQuestions()
    })

    expect(mockFetchContextGenerateSuggestedQuestions).not.toHaveBeenCalled()
  })

  it('should pass parameter info and available vars when fetching suggestions and allow force refetch', async () => {
    mockAvailableVarHookState.value = {
      availableVars,
      availableNodesWithParent: availableNodes,
    }

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions()
    })

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions({ force: true })
    })

    expect(mockFetchContextGenerateSuggestedQuestions).toHaveBeenCalledTimes(2)
    expect(mockFetchContextGenerateSuggestedQuestions).toHaveBeenNthCalledWith(1, expect.objectContaining({
      language: 'English',
      available_vars: [{
        value_selector: ['start-node', 'result'],
        type: VarType.string,
        node_id: 'start-node',
        node_title: 'Start',
        node_type: 'start',
        schema: undefined,
      }],
      parameter_info: expect.objectContaining({
        name: 'query',
        type: 'string',
        description: 'Query string',
        label: 'Query',
      }),
    }), expect.any(Function))
  })

  it('should surface suggestion request errors and ignore aborted requests', async () => {
    mockFetchContextGenerateSuggestedQuestions.mockResolvedValueOnce({
      error: 'network-error',
      questions: [],
    })

    const { result, rerender } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions()
    })

    expect(mockToastError).toHaveBeenCalledWith('pluginTrigger.modal.errors.networkError')
    expect(result.current.suggestedQuestions).toEqual([])
    expect(result.current.hasFetchedSuggestions).toBe(false)

    mockFetchContextGenerateSuggestedQuestions.mockImplementationOnce(async () => {
      throw new Error('AbortError')
    })

    rerender()
    await act(async () => {
      await result.current.handleFetchSuggestedQuestions()
    })

    expect(mockToastError).toHaveBeenCalledTimes(1)
  })

  it('should handle unexpected suggestion failures by clearing questions and toasting', async () => {
    mockFetchContextGenerateSuggestedQuestions.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions()
    })

    expect(mockToastError).toHaveBeenCalledWith('pluginTrigger.modal.errors.networkError')
    expect(result.current.suggestedQuestions).toEqual([])
    expect(result.current.hasFetchedSuggestions).toBe(false)
  })

  it('should no-op generate when the input is empty or when required ids are missing', async () => {
    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(mockGenerateContext).not.toHaveBeenCalled()

    const { result: missingIdsResult } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: '',
      paramKey: '',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    act(() => {
      missingIdsResult.current.setInputValue('Generate code')
    })

    await act(async () => {
      await missingIdsResult.current.handleGenerate()
    })

    expect(mockGenerateContext).not.toHaveBeenCalled()
  })

  it('should toast generate errors without appending a new version', async () => {
    mockGenerateContext.mockResolvedValueOnce({
      variables: [],
      outputs: {},
      code_language: CodeLanguage.python3,
      code: '',
      message: '',
      error: 'generation failed',
    })

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    act(() => {
      result.current.setInputValue('Generate a better extractor')
    })

    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(mockToastError).toHaveBeenCalledWith('generation failed')
    expect(result.current.promptMessages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Generate a better extractor',
      }),
    ])
    expect(result.current.versions).toEqual([])
  })

  it('should fall back to the default assistant message and reset history when idle', async () => {
    mockGenerateContext.mockResolvedValueOnce({
      variables: [{ variable: 'result', value_selector: ['result'] }],
      outputs: { result: { type: 'string' } },
      code_language: CodeLanguage.javascript,
      code: 'return result',
      message: '',
      error: '',
    })

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    act(() => {
      result.current.setInputValue('Generate with default message')
    })

    await act(async () => {
      await result.current.handleGenerate()
    })

    await waitFor(() => {
      expect(result.current.promptMessages[1].content).toBe('workflow.nodes.tool.contextGenerate.defaultAssistantMessage')
      expect(result.current.current?.code).toBe('return result')
      expect(mockGenerateContext).toHaveBeenCalledWith(expect.objectContaining({
        language: CodeLanguage.python3,
        code_context: {
          code: 'print(result)',
          outputs: { result: { type: VarType.string } },
          variables: [{ variable: 'result', value_selector: ['result'] }],
        },
      }))
    })

    act(() => {
      result.current.handleReset()
    })

    expect(result.current.promptMessages).toEqual([])
    expect(result.current.versions).toEqual([])
    expect(result.current.inputValue).toBe('')
  })

  it('should expose a blank chat model when neither a default model nor an override exists', () => {
    mockDefaultModelState.value = null

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData: buildCodeNodeData({
        outputs: undefined,
        variables: undefined,
      }),
      availableVars,
      availableNodes,
    }))

    expect(result.current.model).toEqual(expect.objectContaining({
      name: '',
      provider: '',
    }))
  })

  it('should fall back to default parameter metadata and derived vars when explicit arrays are empty', async () => {
    mockWorkflowNodesState.value = [{
      id: 'tool-node',
      data: {
        paramSchemas: [{
          name: 'other',
          type: 'number',
        } as ToolParameter],
      },
    }]
    mockAvailableVarHookState.value = {
      availableVars,
      availableNodesWithParent: availableNodes,
    }

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData: buildCodeNodeData({
        code: '',
        outputs: undefined,
        variables: undefined,
      }),
      availableVars: [],
      availableNodes: [],
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions({ force: true })
    })

    expect(mockFetchContextGenerateSuggestedQuestions).toHaveBeenCalledWith(expect.objectContaining({
      available_vars: expect.any(Array),
      parameter_info: expect.objectContaining({
        name: 'query',
        type: 'string',
        description: '',
      }),
    }), expect.any(Function))
    expect(result.current.availableVars).toEqual(availableVars)
    expect(result.current.availableNodes).toEqual(availableNodes)
  })

  it('should preserve history during an in-flight generation and allow resetting fetched suggestions', async () => {
    let resolveGenerate: ((value: Awaited<ReturnType<typeof mockGenerateContext>>) => void) | null = null
    mockGenerateContext.mockImplementationOnce(() => new Promise((resolve) => {
      resolveGenerate = resolve as typeof resolveGenerate
    }))

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    act(() => {
      result.current.setInputValue('Generate and keep state')
    })

    await act(async () => {
      void result.current.handleGenerate()
    })

    act(() => {
      result.current.handleReset()
      result.current.resetSuggestions()
    })

    expect(result.current.promptMessages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Generate and keep state',
      }),
    ])
    expect(result.current.hasFetchedSuggestions).toBe(false)

    await act(async () => {
      resolveGenerate?.({
        variables: [],
        outputs: {},
        code_language: CodeLanguage.javascript,
        code: '',
        message: 'done',
        error: '',
      })
    })
  })

  it('should derive parameter metadata from locale fallbacks and restore empty completion params from storage', async () => {
    mockStorageGet.mockReturnValue({
      provider: 'anthropic',
      name: 'claude-3-7-sonnet',
      mode: 'chat',
    })
    mockWorkflowNodesState.value = [{
      id: 'tool-node',
      data: {
        paramSchemas: [{
          name: 'query',
          type: '',
          llm_description: '',
          human_description: { en_US: 'Fallback description' },
          label: { en_US: 'Fallback label' },
          options: [{ value: 'a' }, { value: 'b' }],
          min: 1,
          max: 3,
          multiple: true,
        } as ToolParameter],
      },
    }]

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions({ force: true })
    })

    expect(result.current.model).toEqual(expect.objectContaining({
      completion_params: {},
    }))
    expect(mockFetchContextGenerateSuggestedQuestions).toHaveBeenCalledWith(expect.objectContaining({
      parameter_info: expect.objectContaining({
        name: 'query',
        type: 'string',
        description: 'Fallback description',
        label: 'Fallback label',
        options: ['a', 'b'],
        min: 1,
        max: 3,
        multiple: true,
      }),
    }), expect.any(Function))
  })

  it('should fall back to empty descriptions, empty param keys, empty types, and en-US labels when locale-specific values are missing', () => {
    mockLocaleState.value = 'ja_JP'
    mockWorkflowNodesState.value = [{
      id: 'tool-node',
      data: {
        paramSchemas: [{
          name: '',
          type: '',
          llm_description: '',
          human_description: {},
          label: { en_US: 'Fallback label' },
        } as ToolParameter],
      },
    }]

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-empty',
      toolNodeId: 'tool-node',
      paramKey: '',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    expect(result.current.promptMessages).toEqual([])
    expect(result.current.model).toEqual(expect.objectContaining({
      provider: 'openai',
      name: 'gpt-4o',
    }))
  })

  it('should build non-latest version labels and tolerate empty suggested-question payloads and zero timestamps', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValue(10)
    mockFetchContextGenerateSuggestedQuestions.mockResolvedValueOnce({})

    const generateResponses = [
      {
        variables: [],
        outputs: {},
        code_language: CodeLanguage.javascript,
        code: 'first',
        message: 'first message',
        error: '',
      },
      {
        variables: [],
        outputs: {},
        code_language: CodeLanguage.javascript,
        code: 'second',
        message: 'second message',
        error: '',
      },
    ]
    mockGenerateContext.mockImplementation(() => Promise.resolve(generateResponses.shift()))

    const { result } = renderHook(() => useContextGenerate({
      storageKey: 'flow-1-tool-node-query',
      toolNodeId: 'tool-node',
      paramKey: 'query',
      codeNodeData,
      availableVars,
      availableNodes,
    }))

    await act(async () => {
      await result.current.handleFetchSuggestedQuestions({ force: true })
    })

    act(() => {
      result.current.setInputValue('first')
    })
    await act(async () => {
      await result.current.handleGenerate()
    })
    act(() => {
      result.current.setInputValue('second')
    })
    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(result.current.suggestedQuestions).toEqual([])
    expect(result.current.versionOptions[0]?.label).toBe('appDebug.generate.version 1')
    expect(result.current.versionOptions[1]?.label).toContain('appDebug.generate.latest')
    expect(result.current.promptMessages[1]).toEqual(expect.objectContaining({
      durationMs: 0,
    }))
    vi.restoreAllMocks()
  })
})
