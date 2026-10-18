import type { ReactNode } from 'react'
import type {
  WorkflowToolOutputVariable,
  WorkflowToolProviderRequest,
  WorkflowToolProviderResponse,
} from '@/app/components/tools/types'
import type { InputVar } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { isParametersOutdated, useConfigureButton } from '../use-configure-button'

const mockCreateWorkflowToolProvider = vi.fn()
const mockSaveWorkflowToolProvider = vi.fn()
vi.mock('@/service/tools', () => ({
  createWorkflowToolProvider: (...args: unknown[]) => mockCreateWorkflowToolProvider(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
}))

const getDetail = vi.fn()

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children)
const workflowToolsKey = consoleQuery.workspaces.current.tools.workflow.get.queryKey()
const detailKey = consoleQuery.workspaces.current.toolProvider.workflow.get.get.queryKey({
  input: { query: { workflow_app_id: 'app-123' } },
})
const isInvalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated

const mockToastNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
  },
}))

const createMockEmoji = () => ({ content: '🔧', background: '#ffffff' })

const createMockInputVar = (overrides: Partial<InputVar> = {}): InputVar =>
  ({
    variable: 'test_var',
    label: 'Test Variable',
    type: InputVarType.textInput,
    required: true,
    max_length: 100,
    options: [],
    ...overrides,
  }) as InputVar

const createMockVariable = (
  overrides: Partial<WorkflowToolOutputVariable> = {},
): WorkflowToolOutputVariable =>
  ({
    variable: 'output_var',
    value_type: 'string',
    source: { nodeId: 'end-1', nodeTitle: 'Success End', outputIndex: 0 },
    ...overrides,
  }) as WorkflowToolOutputVariable

const createMockDetail = (
  overrides: Partial<WorkflowToolProviderResponse> = {},
): WorkflowToolProviderResponse => ({
  workflow_app_id: 'app-123',
  workflow_tool_id: 'tool-456',
  label: 'Test Tool',
  name: 'test_tool',
  icon: createMockEmoji(),
  description: 'A test workflow tool',
  synced: true,
  tool: {
    author: 'test-author',
    name: 'test_tool',
    label: { en_US: 'Test Tool', zh_Hans: '测试工具' },
    description: { en_US: 'Test description', zh_Hans: '测试描述' },
    labels: ['label1'],
    parameters: [
      {
        name: 'test_var',
        label: { en_US: 'Test Variable', zh_Hans: '测试变量' },
        human_description: { en_US: 'A test variable', zh_Hans: '测试变量' },
        type: 'string',
        form: 'llm',
        llm_description: 'Test variable description',
        required: true,
        default: '',
      },
    ],
    output_schema: {
      type: 'object',
      properties: {
        output_var: { type: 'string', description: 'Output description' },
      },
    },
  },
  privacy_policy: 'https://example.com/privacy',
  ...overrides,
})

const createDefaultOptions = (overrides = {}) => ({
  enabled: true,
  published: false,
  detailNeedUpdate: false,
  workflowAppId: 'app-123',
  icon: createMockEmoji(),
  name: 'Test Workflow',
  description: 'Test workflow description',
  inputs: [createMockInputVar()],
  outputs: [createMockVariable()],
  handlePublish: vi.fn().mockResolvedValue(undefined),
  onRefreshData: vi.fn(),
  ...overrides,
})

const createMockRequest = (
  extra: Record<string, string> = {},
): WorkflowToolProviderRequest & Record<string, unknown> => ({
  name: 'test_tool',
  description: 'desc',
  icon: createMockEmoji(),
  label: 'Test Tool',
  parameters: [{ name: 'test_var', description: '', form: 'llm' }],
  labels: [],
  privacy_policy: '',
  ...extra,
})

describe('isParametersOutdated', () => {
  it('should return false when detail is undefined', () => {
    expect(isParametersOutdated(undefined, [createMockInputVar()])).toBe(false)
  })

  it('should return true when parameter count differs', () => {
    const detail = createMockDetail()
    const inputs = [
      createMockInputVar({ variable: 'test_var' }),
      createMockInputVar({ variable: 'extra_var' }),
    ]
    expect(isParametersOutdated(detail, inputs)).toBe(true)
  })

  it('should return true when parameter is not found in detail', () => {
    const detail = createMockDetail()
    const inputs = [createMockInputVar({ variable: 'unknown_var' })]
    expect(isParametersOutdated(detail, inputs)).toBe(true)
  })

  it('should return true when required property differs', () => {
    const detail = createMockDetail()
    const inputs = [createMockInputVar({ variable: 'test_var', required: false })]
    expect(isParametersOutdated(detail, inputs)).toBe(true)
  })

  it('should return true when paragraph type does not match string', () => {
    const detail = createMockDetail()
    detail.tool.parameters[0]!.type = 'number'
    const inputs = [createMockInputVar({ variable: 'test_var', type: InputVarType.paragraph })]
    expect(isParametersOutdated(detail, inputs)).toBe(true)
  })

  it('should return true when text-input type does not match string', () => {
    const detail = createMockDetail()
    detail.tool.parameters[0]!.type = 'number'
    const inputs = [createMockInputVar({ variable: 'test_var', type: InputVarType.textInput })]
    expect(isParametersOutdated(detail, inputs)).toBe(true)
  })

  it('should return false when paragraph type matches string', () => {
    const detail = createMockDetail()
    const inputs = [createMockInputVar({ variable: 'test_var', type: InputVarType.paragraph })]
    expect(isParametersOutdated(detail, inputs)).toBe(false)
  })

  it('should return false when text-input type matches string', () => {
    const detail = createMockDetail()
    const inputs = [createMockInputVar({ variable: 'test_var', type: InputVarType.textInput })]
    expect(isParametersOutdated(detail, inputs)).toBe(false)
  })

  it('should handle undefined inputs with empty detail parameters', () => {
    const detail = createMockDetail()
    detail.tool.parameters = []
    expect(isParametersOutdated(detail, undefined)).toBe(false)
  })

  it('should return true when inputs undefined but detail has parameters', () => {
    const detail = createMockDetail()
    expect(isParametersOutdated(detail, undefined)).toBe(true)
  })

  it('should handle empty inputs and empty detail parameters', () => {
    const detail = createMockDetail()
    detail.tool.parameters = []
    expect(isParametersOutdated(detail, [])).toBe(false)
  })
})

describe('useConfigureButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(workflowToolsKey, [])
    queryClient.setQueryData<WorkflowToolProviderResponse>(detailKey, createMockDetail())
    getDetail.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initialization', () => {
    it('should forward isLoading from query hook', () => {
      queryClient.removeQueries({ queryKey: detailKey })
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ published: true })),
        { wrapper },
      )
      expect(result.current.isLoading).toBe(true)
    })

    it('fetches detail when published', async () => {
      queryClient.removeQueries({ queryKey: detailKey })
      renderHook(() => useConfigureButton(createDefaultOptions({ published: true })), {
        wrapper,
      })
      await waitFor(() =>
        expect(getDetail).toHaveBeenCalledWith({ query: { workflow_app_id: 'app-123' } }),
      )
    })

    it('should call query hook with enabled=false when not published', () => {
      renderHook(() => useConfigureButton(createDefaultOptions({ published: false })), {
        wrapper,
      })
      expect(getDetail).not.toHaveBeenCalled()
    })

    it('should call query hook with enabled=false when controller is disabled', () => {
      renderHook(
        () => useConfigureButton(createDefaultOptions({ enabled: false, published: true })),
        { wrapper },
      )
      expect(getDetail).not.toHaveBeenCalled()
    })
  })

  // Computed values
  describe('Computed - outdated', () => {
    it('should be false when not published (no detail)', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()), {
        wrapper,
      })
      expect(result.current.outdated).toBe(false)
    })

    it('should be true when parameters differ', () => {
      const { result } = renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              published: true,
              inputs: [
                createMockInputVar({ variable: 'test_var' }),
                createMockInputVar({ variable: 'extra_var' }),
              ],
            }),
          ),
        { wrapper },
      )
      expect(result.current.outdated).toBe(true)
    })

    it('should be false when parameters match', () => {
      const { result } = renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              published: true,
              inputs: [createMockInputVar({ variable: 'test_var', required: true })],
            }),
          ),
        { wrapper },
      )
      expect(result.current.outdated).toBe(false)
    })
  })

  describe('Computed - payload', () => {
    it('should use prop values when not published', () => {
      queryClient.removeQueries({ queryKey: detailKey })
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()), {
        wrapper,
      })

      expect(result.current.payload).toMatchObject({
        icon: createMockEmoji(),
        label: 'Test Workflow',
        name: '',
        description: 'Test workflow description',
        workflow_app_id: 'app-123',
      })
      expect(result.current.payload.parameters).toHaveLength(1)
      expect(result.current.payload.parameters[0]).toMatchObject({
        name: 'test_var',
        form: 'llm',
        description: '',
      })
      expect(result.current.payload.outputParameters[0]).toMatchObject({
        name: 'output_var',
        source: { nodeId: 'end-1', nodeTitle: 'Success End', outputIndex: 0 },
      })
    })

    it('should use detail values when published with detail', () => {
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ published: true })),
        { wrapper },
      )

      expect(result.current.payload).toMatchObject({
        icon: createMockEmoji(),
        label: 'Test Tool',
        name: 'test_tool',
        description: 'A test workflow tool',
        workflow_tool_id: 'tool-456',
        privacy_policy: 'https://example.com/privacy',
        labels: ['label1'],
      })
      expect(result.current.payload.parameters[0]).toMatchObject({
        name: 'test_var',
        description: 'Test variable description',
        form: 'llm',
      })
      expect(result.current.payload.outputParameters).toEqual([
        expect.objectContaining({ name: 'output_var', description: 'Output description' }),
      ])
    })

    it('should return empty parameters when published without detail', () => {
      queryClient.removeQueries({ queryKey: detailKey })
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ published: true })),
        { wrapper },
      )

      expect(result.current.payload.parameters).toHaveLength(0)
      expect(result.current.payload.outputParameters).toHaveLength(0)
    })

    it('should handle undefined output_schema in detail', () => {
      const detail = createMockDetail()
      // @ts-expect-error - testing undefined case
      detail.tool.output_schema = undefined
      queryClient.setQueryData<WorkflowToolProviderResponse>(detailKey, detail)

      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ published: true })),
        { wrapper },
      )

      expect(result.current.payload.outputParameters[0]).toMatchObject({
        name: 'output_var',
        description: '',
      })
    })

    it('should convert paragraph type to string in existing parameters', () => {
      const { result } = renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              published: true,
              inputs: [createMockInputVar({ variable: 'test_var', type: InputVarType.paragraph })],
            }),
          ),
        { wrapper },
      )

      expect(result.current.payload.parameters[0]!.type).toBe('string')
    })
  })

  // Mutation handlers
  describe('handleCreate', () => {
    it('should publish before creating the provider', async () => {
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ handlePublish })),
        { wrapper },
      )

      await act(async () => {
        await result.current.handleCreate(
          createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & {
            workflow_app_id: string
          },
        )
      })

      expect(handlePublish).toHaveBeenCalledOnce()
      expect(mockCreateWorkflowToolProvider).toHaveBeenCalledOnce()
      expect(handlePublish.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateWorkflowToolProvider.mock.invocationCallOrder[0]!,
      )
    })

    it('should not create the provider when publishing fails', async () => {
      const handlePublish = vi.fn().mockRejectedValue(new Error('Publish failed'))
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ handlePublish })),
        { wrapper },
      )

      await act(async () => {
        await result.current.handleCreate(
          createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & {
            workflow_app_id: string
          },
        )
      })

      expect(mockCreateWorkflowToolProvider).not.toHaveBeenCalled()
      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Publish failed' })
    })

    it('should create provider, invalidate caches, refresh, and notify configured', async () => {
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const onRefreshData = vi.fn()
      const onConfigured = vi.fn()
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ onRefreshData, onConfigured })),
        { wrapper },
      )

      await act(async () => {
        await result.current.handleCreate(
          createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & {
            workflow_app_id: string
          },
        )
      })

      expect(mockCreateWorkflowToolProvider).toHaveBeenCalledWith(
        createMockRequest({ workflow_app_id: 'app-123' }),
      )
      expect(isInvalidated(workflowToolsKey)).toBe(true)
      expect(onRefreshData).toHaveBeenCalled()
      expect(isInvalidated(detailKey)).toBe(true)
      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'success', message: expect.any(String) })
      expect(onConfigured).toHaveBeenCalled()
    })

    it('should show error toast on failure', async () => {
      mockCreateWorkflowToolProvider.mockRejectedValue(new Error('Create failed'))
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()), {
        wrapper,
      })

      await act(async () => {
        await result.current.handleCreate(
          createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & {
            workflow_app_id: string
          },
        )
      })

      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Create failed' })
      expect(isInvalidated(workflowToolsKey)).toBe(false)
      expect(isInvalidated(detailKey)).toBe(false)
    })
  })

  describe('handleUpdate', () => {
    it('should publish, save, invalidate caches, and notify configured', async () => {
      mockSaveWorkflowToolProvider.mockResolvedValue({})
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      const onRefreshData = vi.fn()
      const onConfigured = vi.fn()
      const { result } = renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              published: true,
              handlePublish,
              onRefreshData,
              onConfigured,
            }),
          ),
        { wrapper },
      )

      await act(async () => {
        await result.current.handleUpdate(createMockRequest({ workflow_tool_id: 'tool-456' }))
      })

      expect(handlePublish).toHaveBeenCalled()
      expect(mockSaveWorkflowToolProvider).toHaveBeenCalledWith(
        createMockRequest({ workflow_tool_id: 'tool-456' }),
      )
      expect(onRefreshData).toHaveBeenCalled()
      expect(isInvalidated(workflowToolsKey)).toBe(true)
      expect(isInvalidated(detailKey)).toBe(true)
      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'success', message: expect.any(String) })
      expect(onConfigured).toHaveBeenCalled()
    })

    it('should show error toast when publish fails', async () => {
      const handlePublish = vi.fn().mockRejectedValue(new Error('Publish failed'))
      const { result } = renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              published: true,
              handlePublish,
            }),
          ),
        { wrapper },
      )

      await act(async () => {
        await result.current.handleUpdate(createMockRequest())
      })

      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Publish failed' })
    })

    it('should show error toast when save fails', async () => {
      mockSaveWorkflowToolProvider.mockRejectedValue(new Error('Save failed'))
      const { result } = renderHook(
        () => useConfigureButton(createDefaultOptions({ published: true })),
        { wrapper },
      )

      await act(async () => {
        await result.current.handleUpdate(createMockRequest())
      })

      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Save failed' })
      expect(isInvalidated(workflowToolsKey)).toBe(false)
      expect(isInvalidated(detailKey)).toBe(false)
    })
  })

  // Effects
  describe('Effects', () => {
    it('should invalidate detail when detailNeedUpdate becomes true', () => {
      const options = createDefaultOptions({ published: true, detailNeedUpdate: false })
      const { rerender } = renderHook(
        (props: ReturnType<typeof createDefaultOptions>) => useConfigureButton(props),
        { initialProps: options, wrapper },
      )

      expect(isInvalidated(detailKey)).toBe(false)
      rerender({ ...options, detailNeedUpdate: true })

      expect(isInvalidated(detailKey)).toBe(true)
    })

    it('should not invalidate detail while disabled', () => {
      renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              enabled: false,
              published: true,
              detailNeedUpdate: true,
            }),
          ),
        { wrapper },
      )

      expect(isInvalidated(detailKey)).toBe(false)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle undefined inputs and outputs', () => {
      const { result } = renderHook(
        () =>
          useConfigureButton(
            createDefaultOptions({
              inputs: undefined,
              outputs: undefined,
            }),
          ),
        { wrapper },
      )

      expect(result.current.payload.parameters).toHaveLength(0)
      expect(result.current.payload.outputParameters).toHaveLength(0)
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.workflow.get.get': (input) => getDetail(input),
    }),
  }
})
