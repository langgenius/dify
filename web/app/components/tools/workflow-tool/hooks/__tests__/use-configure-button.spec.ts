import type { WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { isParametersOutdated, useConfigureButton } from '../use-configure-button'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockIsCurrentWorkspaceManager = vi.fn(() => true)
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
  }),
}))

const mockCreateWorkflowToolProvider = vi.fn()
const mockSaveWorkflowToolProvider = vi.fn()
vi.mock('@/service/tools', () => ({
  createWorkflowToolProvider: (...args: unknown[]) => mockCreateWorkflowToolProvider(...args),
  saveWorkflowToolProvider: (...args: unknown[]) => mockSaveWorkflowToolProvider(...args),
}))

const mockInvalidateAllWorkflowTools = vi.fn()
const mockInvalidateWorkflowToolDetailByAppID = vi.fn()
const mockUseWorkflowToolDetailByAppID = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useInvalidateAllWorkflowTools: () => mockInvalidateAllWorkflowTools,
  useInvalidateWorkflowToolDetailByAppID: () => mockInvalidateWorkflowToolDetailByAppID,
  useWorkflowToolDetailByAppID: (...args: unknown[]) => mockUseWorkflowToolDetailByAppID(...args),
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (options: { type: string, message: string }) => mockToastNotify(options),
  },
}))

const createMockEmoji = () => ({ content: '🔧', background: '#ffffff' })

const createMockInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  variable: 'test_var',
  label: 'Test Variable',
  type: InputVarType.textInput,
  required: true,
  max_length: 100,
  options: [],
  ...overrides,
} as InputVar)

const createMockVariable = (overrides: Partial<Variable> = {}): Variable => ({
  variable: 'output_var',
  value_type: 'string',
  ...overrides,
} as Variable)

const createMockDetail = (overrides: Partial<WorkflowToolProviderResponse> = {}): WorkflowToolProviderResponse => ({
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

const createMockRequest = (extra: Record<string, string> = {}): WorkflowToolProviderRequest & Record<string, unknown> => ({
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
    detail.tool.parameters[0].type = 'number'
    const inputs = [createMockInputVar({ variable: 'test_var', type: InputVarType.paragraph })]
    expect(isParametersOutdated(detail, inputs)).toBe(true)
  })

  it('should return true when text-input type does not match string', () => {
    const detail = createMockDetail()
    detail.tool.parameters[0].type = 'number'
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

  it('should return false when all parameters match', () => {
    const detail = createMockDetail()
    const inputs = [createMockInputVar({ variable: 'test_var', required: true })]
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
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockUseWorkflowToolDetailByAppID.mockImplementation((_appId: string, enabled: boolean) => ({
      data: enabled ? createMockDetail() : undefined,
      isLoading: false,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initialization', () => {
    it('should return showModal as false by default', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))
      expect(result.current.showModal).toBe(false)
    })

    it('should forward isCurrentWorkspaceManager from context', () => {
      mockIsCurrentWorkspaceManager.mockReturnValue(false)
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))
      expect(result.current.isCurrentWorkspaceManager).toBe(false)
    })

    it('should forward isLoading from query hook', () => {
      mockUseWorkflowToolDetailByAppID.mockReturnValue({ data: undefined, isLoading: true })
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))
      expect(result.current.isLoading).toBe(true)
    })

    it('should call query hook with enabled=true when published', () => {
      renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))
      expect(mockUseWorkflowToolDetailByAppID).toHaveBeenCalledWith('app-123', true)
    })

    it('should call query hook with enabled=false when not published', () => {
      renderHook(() => useConfigureButton(createDefaultOptions({ published: false })))
      expect(mockUseWorkflowToolDetailByAppID).toHaveBeenCalledWith('app-123', false)
    })
  })

  // Computed values
  describe('Computed - outdated', () => {
    it('should be false when not published (no detail)', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))
      expect(result.current.outdated).toBe(false)
    })

    it('should be true when parameters differ', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        published: true,
        inputs: [
          createMockInputVar({ variable: 'test_var' }),
          createMockInputVar({ variable: 'extra_var' }),
        ],
      })))
      expect(result.current.outdated).toBe(true)
    })

    it('should be false when parameters match', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        published: true,
        inputs: [createMockInputVar({ variable: 'test_var', required: true })],
      })))
      expect(result.current.outdated).toBe(false)
    })
  })

  describe('Computed - payload', () => {
    it('should use prop values when not published', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))

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
    })

    it('should use detail values when published with detail', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))

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
    })

    it('should return empty parameters when published without detail', () => {
      mockUseWorkflowToolDetailByAppID.mockReturnValue({ data: undefined, isLoading: false })
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))

      expect(result.current.payload.parameters).toHaveLength(0)
      expect(result.current.payload.outputParameters).toHaveLength(0)
    })

    it('should build output parameters from detail output_schema', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))

      expect(result.current.payload.outputParameters).toHaveLength(1)
      expect(result.current.payload.outputParameters[0]).toMatchObject({
        name: 'output_var',
        description: 'Output description',
      })
    })

    it('should handle undefined output_schema in detail', () => {
      const detail = createMockDetail()
      // @ts-expect-error - testing undefined case
      detail.tool.output_schema = undefined
      mockUseWorkflowToolDetailByAppID.mockReturnValue({ data: detail, isLoading: false })

      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))

      expect(result.current.payload.outputParameters[0]).toMatchObject({
        name: 'output_var',
        description: '',
      })
    })

    it('should convert paragraph type to string in existing parameters', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        published: true,
        inputs: [createMockInputVar({ variable: 'test_var', type: InputVarType.paragraph })],
      })))

      expect(result.current.payload.parameters[0].type).toBe('string')
    })
  })

  // Modal controls
  describe('Modal Controls', () => {
    it('should open modal via openModal', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))
      act(() => {
        result.current.openModal()
      })
      expect(result.current.showModal).toBe(true)
    })

    it('should close modal via closeModal', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))
      act(() => {
        result.current.openModal()
      })
      act(() => {
        result.current.closeModal()
      })
      expect(result.current.showModal).toBe(false)
    })

    it('should navigate to tools page', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))
      act(() => {
        result.current.navigateToTools()
      })
      expect(mockPush).toHaveBeenCalledWith('/tools?category=workflow')
    })
  })

  // Mutation handlers
  describe('handleCreate', () => {
    it('should create provider, invalidate caches, refresh, and close modal', async () => {
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const onRefreshData = vi.fn()
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ onRefreshData })))

      act(() => {
        result.current.openModal()
      })

      await act(async () => {
        await result.current.handleCreate(createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & { workflow_app_id: string })
      })

      expect(mockCreateWorkflowToolProvider).toHaveBeenCalled()
      expect(mockInvalidateAllWorkflowTools).toHaveBeenCalled()
      expect(onRefreshData).toHaveBeenCalled()
      expect(mockInvalidateWorkflowToolDetailByAppID).toHaveBeenCalledWith('app-123')
      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'success', message: expect.any(String) })
      expect(result.current.showModal).toBe(false)
    })

    it('should show error toast on failure', async () => {
      mockCreateWorkflowToolProvider.mockRejectedValue(new Error('Create failed'))
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions()))

      await act(async () => {
        await result.current.handleCreate(createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & { workflow_app_id: string })
      })

      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Create failed' })
    })
  })

  describe('handleUpdate', () => {
    it('should publish, save, invalidate caches, and close modal', async () => {
      mockSaveWorkflowToolProvider.mockResolvedValue({})
      const handlePublish = vi.fn().mockResolvedValue(undefined)
      const onRefreshData = vi.fn()
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        published: true,
        handlePublish,
        onRefreshData,
      })))

      act(() => {
        result.current.openModal()
      })

      await act(async () => {
        await result.current.handleUpdate(createMockRequest({ workflow_tool_id: 'tool-456' }) as WorkflowToolProviderRequest & Partial<{ workflow_app_id: string, workflow_tool_id: string }>)
      })

      expect(handlePublish).toHaveBeenCalled()
      expect(mockSaveWorkflowToolProvider).toHaveBeenCalled()
      expect(onRefreshData).toHaveBeenCalled()
      expect(mockInvalidateAllWorkflowTools).toHaveBeenCalled()
      expect(mockInvalidateWorkflowToolDetailByAppID).toHaveBeenCalledWith('app-123')
      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'success', message: expect.any(String) })
      expect(result.current.showModal).toBe(false)
    })

    it('should show error toast when publish fails', async () => {
      const handlePublish = vi.fn().mockRejectedValue(new Error('Publish failed'))
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        published: true,
        handlePublish,
      })))

      await act(async () => {
        await result.current.handleUpdate(createMockRequest() as WorkflowToolProviderRequest & Partial<{ workflow_app_id: string, workflow_tool_id: string }>)
      })

      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Publish failed' })
    })

    it('should show error toast when save fails', async () => {
      mockSaveWorkflowToolProvider.mockRejectedValue(new Error('Save failed'))
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))

      await act(async () => {
        await result.current.handleUpdate(createMockRequest() as WorkflowToolProviderRequest & Partial<{ workflow_app_id: string, workflow_tool_id: string }>)
      })

      expect(mockToastNotify).toHaveBeenCalledWith({ type: 'error', message: 'Save failed' })
    })
  })

  // Effects
  describe('Effects', () => {
    it('should invalidate detail when detailNeedUpdate becomes true', () => {
      const options = createDefaultOptions({ published: true, detailNeedUpdate: false })
      const { rerender } = renderHook(
        (props: ReturnType<typeof createDefaultOptions>) => useConfigureButton(props),
        { initialProps: options },
      )

      rerender({ ...options, detailNeedUpdate: true })

      expect(mockInvalidateWorkflowToolDetailByAppID).toHaveBeenCalledWith('app-123')
    })

    it('should not invalidate when detailNeedUpdate stays false', () => {
      const options = createDefaultOptions({ published: true, detailNeedUpdate: false })
      const { rerender } = renderHook(
        (props: ReturnType<typeof createDefaultOptions>) => useConfigureButton(props),
        { initialProps: options },
      )

      rerender({ ...options })

      expect(mockInvalidateWorkflowToolDetailByAppID).not.toHaveBeenCalled()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle undefined detail from query gracefully', () => {
      mockUseWorkflowToolDetailByAppID.mockReturnValue({ data: undefined, isLoading: false })
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({ published: true })))

      expect(result.current.outdated).toBe(false)
      expect(result.current.payload.parameters).toHaveLength(0)
    })

    it('should handle detail with empty parameters', () => {
      const detail = createMockDetail()
      detail.tool.parameters = []
      mockUseWorkflowToolDetailByAppID.mockReturnValue({ data: detail, isLoading: false })

      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        published: true,
        inputs: [],
      })))

      expect(result.current.outdated).toBe(false)
    })

    it('should handle undefined inputs and outputs', () => {
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        inputs: undefined,
        outputs: undefined,
      })))

      expect(result.current.payload.parameters).toHaveLength(0)
      expect(result.current.payload.outputParameters).toHaveLength(0)
    })

    it('should handle missing onRefreshData callback in create', async () => {
      mockCreateWorkflowToolProvider.mockResolvedValue({})
      const { result } = renderHook(() => useConfigureButton(createDefaultOptions({
        onRefreshData: undefined,
      })))

      // Should not throw
      await act(async () => {
        await result.current.handleCreate(createMockRequest({ workflow_app_id: 'app-123' }) as WorkflowToolProviderRequest & { workflow_app_id: string })
      })

      expect(mockCreateWorkflowToolProvider).toHaveBeenCalled()
    })
  })
})
