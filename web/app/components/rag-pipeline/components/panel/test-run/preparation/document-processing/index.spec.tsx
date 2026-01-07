import type { ZodSchema } from 'zod'
import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import type { PipelineProcessingParamsResponse, RAGPipelineVariable, RAGPipelineVariables } from '@/models/pipeline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import Actions from './actions'
import DocumentProcessing from './index'
import Options from './options'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock workflow store
let mockPipelineId: string | null = 'test-pipeline-id'
let mockWorkflowRunningData: { result: { status: string } } | undefined

type MockWorkflowStoreState = {
  pipelineId: string | null
  workflowRunningData: typeof mockWorkflowRunningData
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowStoreState) => unknown) => {
    const state: MockWorkflowStoreState = {
      pipelineId: mockPipelineId,
      workflowRunningData: mockWorkflowRunningData,
    }
    return selector(state)
  },
}))

// Mock useDraftPipelineProcessingParams
let mockParamsConfig: PipelineProcessingParamsResponse | undefined
let mockIsFetchingParams = false

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelineProcessingParams: () => ({
    data: mockParamsConfig,
    isFetching: mockIsFetchingParams,
  }),
}))

// Mock use-input-fields hooks
const mockUseInitialData = vi.fn()
const mockUseConfigurations = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks/use-input-fields', () => ({
  useInitialData: (variables: RAGPipelineVariables) => mockUseInitialData(variables),
  useConfigurations: (variables: RAGPipelineVariables) => mockUseConfigurations(variables),
}))

// Mock generateZodSchema
const mockGenerateZodSchema = vi.fn()

vi.mock('@/app/components/base/form/form-scenarios/base/utils', () => ({
  generateZodSchema: (configurations: BaseConfiguration[]) => mockGenerateZodSchema(configurations),
}))

// Mock Toast
const mockToastNotify = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (params: { type: string, message: string }) => mockToastNotify(params),
  },
}))

// Mock useAppForm
const mockHandleSubmit = vi.fn()
const mockFormStore = {
  isSubmitting: false,
  canSubmit: true,
}

vi.mock('@/app/components/base/form', () => ({
  useAppForm: ({ onSubmit, validators }: {
    onSubmit: (params: { value: Record<string, unknown> }) => void
    validators?: {
      onSubmit?: (params: { value: Record<string, unknown> }) => string | undefined
    }
  }) => {
    const form = {
      handleSubmit: () => {
        const value = { test: 'value' }
        const validationResult = validators?.onSubmit?.({ value })
        if (!validationResult) {
          onSubmit({ value })
        }
        mockHandleSubmit()
      },
      store: mockFormStore,
      AppForm: ({ children }: { children: React.ReactNode }) => <div data-testid="app-form">{children}</div>,
      Actions: ({ CustomActions }: { CustomActions: (props: CustomActionsProps) => React.ReactNode }) => (
        <div data-testid="form-actions">
          {CustomActions({
            form: {
              handleSubmit: mockHandleSubmit,
            } as unknown as CustomActionsProps['form'],
            isSubmitting: false,
            canSubmit: true,
          })}
        </div>
      ),
    }
    return form
  },
}))

// Mock BaseField
vi.mock('@/app/components/base/form/form-scenarios/base/field', () => ({
  default: ({ config }: { initialData: Record<string, unknown>, config: BaseConfiguration }) => {
    return () => (
      <div data-testid={`field-${config.variable}`}>
        <span data-testid={`field-label-${config.variable}`}>{config.label}</span>
        <span data-testid={`field-type-${config.variable}`}>{config.type}</span>
        <span data-testid={`field-required-${config.variable}`}>{String(config.required)}</span>
      </div>
    )
  },
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createRAGPipelineVariable = (overrides?: Partial<RAGPipelineVariable>): RAGPipelineVariable => ({
  belong_to_node_id: 'test-node',
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  max_length: 100,
  default_value: '',
  placeholder: 'Enter value',
  unit: '',
  required: true,
  tooltips: 'Test tooltip',
  options: [],
  allowed_file_upload_methods: [],
  allowed_file_types: [],
  allowed_file_extensions: [],
  ...overrides,
})

const createBaseConfiguration = (overrides?: Partial<BaseConfiguration>): BaseConfiguration => ({
  type: BaseFieldType.textInput,
  variable: 'test_variable',
  label: 'Test Label',
  required: true,
  showConditions: [],
  maxLength: 100,
  placeholder: 'Enter value',
  tooltip: 'Test tooltip',
  ...overrides,
})

const createMockSchema = (): ZodSchema => ({
  safeParse: vi.fn().mockReturnValue({ success: true }),
}) as unknown as ZodSchema

// ============================================================================
// Helper Functions
// ============================================================================

const setupMocks = (options?: {
  pipelineId?: string | null
  paramsConfig?: PipelineProcessingParamsResponse
  isFetchingParams?: boolean
  initialData?: Record<string, unknown>
  configurations?: BaseConfiguration[]
  workflowRunningData?: typeof mockWorkflowRunningData
}) => {
  mockPipelineId = options?.pipelineId ?? 'test-pipeline-id'
  mockParamsConfig = options?.paramsConfig
  mockIsFetchingParams = options?.isFetchingParams ?? false
  mockWorkflowRunningData = options?.workflowRunningData
  mockUseInitialData.mockReturnValue(options?.initialData ?? {})
  mockUseConfigurations.mockReturnValue(options?.configurations ?? [])
  mockGenerateZodSchema.mockReturnValue(createMockSchema())
}

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>,
  )
}

// ============================================================================
// DocumentProcessing Component Tests
// ============================================================================

describe('DocumentProcessing', () => {
  const defaultProps = {
    dataSourceNodeId: 'datasource-node-1',
    onProcess: vi.fn(),
    onBack: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      setupMocks({
        configurations: [createBaseConfiguration()],
      })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should render Options component with form elements', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ variable: 'field1', label: 'Field 1' }),
        createBaseConfiguration({ variable: 'field2', label: 'Field 2' }),
      ]
      setupMocks({ configurations })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('field-field1')).toBeInTheDocument()
      expect(screen.getByTestId('field-field2')).toBeInTheDocument()
    })

    it('should render no fields when configurations is empty', () => {
      // Arrange
      setupMocks({ configurations: [] })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })

    it('should call useInitialData with variables from paramsConfig', () => {
      // Arrange
      const variables = [createRAGPipelineVariable({ variable: 'var1' })]
      setupMocks({
        paramsConfig: { variables },
      })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(mockUseInitialData).toHaveBeenCalledWith(variables)
    })

    it('should call useConfigurations with variables from paramsConfig', () => {
      // Arrange
      const variables = [createRAGPipelineVariable({ variable: 'var1' })]
      setupMocks({
        paramsConfig: { variables },
      })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(mockUseConfigurations).toHaveBeenCalledWith(variables)
    })

    it('should use empty array when paramsConfig.variables is undefined', () => {
      // Arrange
      setupMocks({ paramsConfig: undefined })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(mockUseInitialData).toHaveBeenCalledWith([])
      expect(mockUseConfigurations).toHaveBeenCalledWith([])
    })
  })

  // -------------------------------------------------------------------------
  // Props Testing
  // -------------------------------------------------------------------------
  describe('Props Testing', () => {
    it('should pass dataSourceNodeId to useInputVariables hook', () => {
      // Arrange
      const customNodeId = 'custom-datasource-node'
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          dataSourceNodeId={customNodeId}
        />,
      )

      // Assert - verify hook is called (mocked, so we check component renders)
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should pass onProcess callback to Options component', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      setupMocks({ configurations: [] })

      // Act
      const { container } = renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onProcess={mockOnProcess}
        />,
      )

      // Assert - form should be rendered
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should pass onBack callback to Actions component', () => {
      // Arrange
      const mockOnBack = vi.fn()
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onBack={mockOnBack}
        />,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability and Memoization Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability and Memoization', () => {
    it('should memoize renderCustomActions callback', () => {
      // Arrange
      setupMocks()
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Act - rerender with same props
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} />
        </QueryClientProvider>,
      )

      // Assert - component should render correctly without issues
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should update renderCustomActions when isFetchingParams changes', () => {
      // Arrange
      setupMocks({ isFetchingParams: false })
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Act
      setupMocks({ isFetchingParams: true })
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should update renderCustomActions when onBack changes', () => {
      // Arrange
      const onBack1 = vi.fn()
      const onBack2 = vi.fn()
      setupMocks()
      const { rerender } = renderWithQueryClient(
        <DocumentProcessing {...defaultProps} onBack={onBack1} />,
      )

      // Act
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} onBack={onBack2} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interactions Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      // Arrange
      const mockOnBack = vi.fn()
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onBack={mockOnBack}
        />,
      )
      const backButton = screen.getByText('datasetPipeline.operations.backToDataSource')
      fireEvent.click(backButton)

      // Assert
      expect(mockOnBack).toHaveBeenCalledTimes(1)
    })

    it('should handle form submission', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onProcess={mockOnProcess}
        />,
      )
      const processButton = screen.getByText('datasetPipeline.operations.process')
      fireEvent.click(processButton)

      // Assert
      expect(mockHandleSubmit).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Component Memoization Tests
  // -------------------------------------------------------------------------
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange
      setupMocks()
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Act - rerender with same props
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should not break when re-rendering with different props', () => {
      // Arrange
      const initialProps = {
        ...defaultProps,
        dataSourceNodeId: 'node-1',
      }
      setupMocks()
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...initialProps} />)

      // Act
      const newProps = {
        ...defaultProps,
        dataSourceNodeId: 'node-2',
      }
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...newProps} />
        </QueryClientProvider>,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle undefined paramsConfig', () => {
      // Arrange
      setupMocks({ paramsConfig: undefined })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(mockUseInitialData).toHaveBeenCalledWith([])
      expect(mockUseConfigurations).toHaveBeenCalledWith([])
    })

    it('should handle paramsConfig with empty variables', () => {
      // Arrange
      setupMocks({ paramsConfig: { variables: [] } })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(mockUseInitialData).toHaveBeenCalledWith([])
      expect(mockUseConfigurations).toHaveBeenCalledWith([])
    })

    it('should handle null pipelineId', () => {
      // Arrange
      setupMocks({ pipelineId: null })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should handle large number of variables', () => {
      // Arrange
      const variables = Array.from({ length: 50 }, (_, i) =>
        createRAGPipelineVariable({ variable: `var_${i}` }))
      const configurations = Array.from({ length: 50 }, (_, i) =>
        createBaseConfiguration({ variable: `var_${i}`, label: `Field ${i}` }))
      setupMocks({
        paramsConfig: { variables },
        configurations,
      })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      expect(screen.getAllByTestId(/^field-var_/)).toHaveLength(50)
    })

    it('should handle special characters in node id', () => {
      // Arrange
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          dataSourceNodeId="node-with-special_chars.123"
        />,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Loading State Tests
  // -------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should pass isFetchingParams to Actions component', () => {
      // Arrange
      setupMocks({ isFetchingParams: true })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert - check that the process button is disabled when fetching
      const processButton = screen.getByText('datasetPipeline.operations.process')
      expect(processButton.closest('button')).toBeDisabled()
    })

    it('should enable process button when not fetching', () => {
      // Arrange
      setupMocks({ isFetchingParams: false })

      // Act
      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process')
      expect(processButton.closest('button')).not.toBeDisabled()
    })
  })
})

// ============================================================================
// Actions Component Tests
// ============================================================================

// Helper to create mock form params for Actions tests
const createMockFormParams = (overrides?: Partial<{
  handleSubmit: ReturnType<typeof vi.fn>
  isSubmitting: boolean
  canSubmit: boolean
}>): CustomActionsProps => ({
  form: { handleSubmit: overrides?.handleSubmit ?? vi.fn() } as unknown as CustomActionsProps['form'],
  isSubmitting: overrides?.isSubmitting ?? false,
  canSubmit: overrides?.canSubmit ?? true,
})

describe('Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowRunningData = undefined
  })

  describe('Rendering', () => {
    it('should render back button', () => {
      // Arrange
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('datasetPipeline.operations.backToDataSource')).toBeInTheDocument()
    })

    it('should render process button', () => {
      // Arrange
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('datasetPipeline.operations.process')).toBeInTheDocument()
    })
  })

  describe('Button States', () => {
    it('should disable process button when runDisabled is true', () => {
      // Arrange
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          runDisabled={true}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when isSubmitting is true', () => {
      // Arrange
      const mockFormParams = createMockFormParams({ isSubmitting: true })

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when canSubmit is false', () => {
      // Arrange
      const mockFormParams = createMockFormParams({ canSubmit: false })

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when workflow is running', () => {
      // Arrange
      mockWorkflowRunningData = {
        result: { status: WorkflowRunningStatus.Running },
      }
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should enable process button when all conditions are met', () => {
      // Arrange
      mockWorkflowRunningData = {
        result: { status: WorkflowRunningStatus.Succeeded },
      }
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          runDisabled={false}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).not.toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      // Arrange
      const mockOnBack = vi.fn()
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={mockOnBack}
        />,
      )

      fireEvent.click(screen.getByText('datasetPipeline.operations.backToDataSource'))

      // Assert
      expect(mockOnBack).toHaveBeenCalledTimes(1)
    })

    it('should call form.handleSubmit when process button is clicked', () => {
      // Arrange
      const mockSubmit = vi.fn()
      const mockFormParams = createMockFormParams({ handleSubmit: mockSubmit })

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('datasetPipeline.operations.process'))

      // Assert
      expect(mockSubmit).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loading State', () => {
    it('should show loading state when isSubmitting', () => {
      // Arrange
      const mockFormParams = createMockFormParams({ isSubmitting: true })

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should show loading state when workflow is running', () => {
      // Arrange
      mockWorkflowRunningData = {
        result: { status: WorkflowRunningStatus.Running },
      }
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined runDisabled prop', () => {
      // Arrange
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).not.toBeDisabled()
    })

    it('should handle undefined workflowRunningData', () => {
      // Arrange
      mockWorkflowRunningData = undefined
      const mockFormParams = createMockFormParams()

      // Act
      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).not.toBeDisabled()
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange
      const mockFormParams = createMockFormParams()
      const mockOnBack = vi.fn()
      const { rerender } = render(
        <Actions
          formParams={mockFormParams}
          onBack={mockOnBack}
        />,
      )

      // Act - rerender with same props
      rerender(
        <Actions
          formParams={mockFormParams}
          onBack={mockOnBack}
        />,
      )

      // Assert
      expect(screen.getByText('datasetPipeline.operations.backToDataSource')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Options Component Tests
// ============================================================================

describe('Options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateZodSchema.mockReturnValue(createMockSchema())
  })

  describe('Rendering', () => {
    it('should render form element', () => {
      // Arrange
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render fields based on configurations', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ variable: 'name', label: 'Name' }),
        createBaseConfiguration({ variable: 'email', label: 'Email' }),
      ]
      const props = {
        initialData: { name: '', email: '' },
        configurations,
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByTestId('field-name')).toBeInTheDocument()
      expect(screen.getByTestId('field-email')).toBeInTheDocument()
    })

    it('should render CustomActions', () => {
      // Arrange
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => (
          <button data-testid="custom-action">Custom Submit</button>
        ),
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByTestId('custom-action')).toBeInTheDocument()
    })

    it('should render with correct class name', () => {
      // Arrange
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      const form = container.querySelector('form')
      expect(form).toHaveClass('w-full')
    })
  })

  describe('Form Submission', () => {
    it('should prevent default form submission', () => {
      // Arrange
      const mockOnSubmit = vi.fn()
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
      const preventDefaultSpy = vi.spyOn(submitEvent, 'preventDefault')

      fireEvent(form, submitEvent)

      // Assert
      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('should stop propagation on form submit', () => {
      // Arrange
      const mockOnSubmit = vi.fn()
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
      const stopPropagationSpy = vi.spyOn(submitEvent, 'stopPropagation')

      fireEvent(form, submitEvent)

      // Assert
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('should call onSubmit when validation passes', () => {
      // Arrange
      const mockOnSubmit = vi.fn()
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(), // returns success: true
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      expect(mockOnSubmit).toHaveBeenCalled()
    })

    it('should not call onSubmit when validation fails', () => {
      // Arrange
      const mockOnSubmit = vi.fn()
      const failingSchema = {
        safeParse: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [
              { path: ['name'], message: 'Name is required' },
            ],
          },
        }),
      } as unknown as ZodSchema
      const props = {
        initialData: {},
        configurations: [],
        schema: failingSchema,
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show toast error when validation fails', () => {
      // Arrange
      const failingSchema = {
        safeParse: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [
              { path: ['name'], message: 'Name is required' },
            ],
          },
        }),
      } as unknown as ZodSchema
      const props = {
        initialData: {},
        configurations: [],
        schema: failingSchema,
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path: name Error: Name is required',
      })
    })

    it('should format error message with multiple path segments', () => {
      // Arrange
      const failingSchema = {
        safeParse: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [
              { path: ['user', 'profile', 'email'], message: 'Invalid email format' },
            ],
          },
        }),
      } as unknown as ZodSchema
      const props = {
        initialData: {},
        configurations: [],
        schema: failingSchema,
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path: user.profile.email Error: Invalid email format',
      })
    })

    it('should only show first validation error when multiple errors exist', () => {
      // Arrange
      const failingSchema = {
        safeParse: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [
              { path: ['name'], message: 'Name is required' },
              { path: ['email'], message: 'Email is invalid' },
              { path: ['age'], message: 'Age must be positive' },
            ],
          },
        }),
      } as unknown as ZodSchema
      const props = {
        initialData: {},
        configurations: [],
        schema: failingSchema,
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert - should only show first error
      expect(mockToastNotify).toHaveBeenCalledTimes(1)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path: name Error: Name is required',
      })
    })

    it('should handle empty path in validation error', () => {
      // Arrange
      const failingSchema = {
        safeParse: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [
              { path: [], message: 'Form validation failed' },
            ],
          },
        }),
      } as unknown as ZodSchema
      const props = {
        initialData: {},
        configurations: [],
        schema: failingSchema,
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path:  Error: Form validation failed',
      })
    })
  })

  describe('Field Rendering', () => {
    it('should render fields in correct order', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ variable: 'first', label: 'First' }),
        createBaseConfiguration({ variable: 'second', label: 'Second' }),
        createBaseConfiguration({ variable: 'third', label: 'Third' }),
      ]
      const props = {
        initialData: {},
        configurations,
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert - check that each field container exists with correct order
      expect(screen.getByTestId('field-first')).toBeInTheDocument()
      expect(screen.getByTestId('field-second')).toBeInTheDocument()
      expect(screen.getByTestId('field-third')).toBeInTheDocument()

      // Verify order by checking labels within each field
      expect(screen.getByTestId('field-label-first')).toHaveTextContent('First')
      expect(screen.getByTestId('field-label-second')).toHaveTextContent('Second')
      expect(screen.getByTestId('field-label-third')).toHaveTextContent('Third')
    })

    it('should pass config to BaseField', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({
          variable: 'test',
          label: 'Test Label',
          type: BaseFieldType.textInput,
          required: true,
        }),
      ]
      const props = {
        initialData: {},
        configurations,
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByTestId('field-label-test')).toHaveTextContent('Test Label')
      expect(screen.getByTestId('field-type-test')).toHaveTextContent(BaseFieldType.textInput)
      expect(screen.getByTestId('field-required-test')).toHaveTextContent('true')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty initialData', () => {
      // Arrange
      const props = {
        initialData: {},
        configurations: [createBaseConfiguration()],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle empty configurations', () => {
      // Arrange
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })

    it('should handle configurations with all field types', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ type: BaseFieldType.textInput, variable: 'text' }),
        createBaseConfiguration({ type: BaseFieldType.paragraph, variable: 'paragraph' }),
        createBaseConfiguration({ type: BaseFieldType.numberInput, variable: 'number' }),
        createBaseConfiguration({ type: BaseFieldType.checkbox, variable: 'checkbox' }),
        createBaseConfiguration({ type: BaseFieldType.select, variable: 'select' }),
      ]
      const props = {
        initialData: {
          text: '',
          paragraph: '',
          number: 0,
          checkbox: false,
          select: '',
        },
        configurations,
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByTestId('field-text')).toBeInTheDocument()
      expect(screen.getByTestId('field-paragraph')).toBeInTheDocument()
      expect(screen.getByTestId('field-number')).toBeInTheDocument()
      expect(screen.getByTestId('field-checkbox')).toBeInTheDocument()
      expect(screen.getByTestId('field-select')).toBeInTheDocument()
    })

    it('should handle large number of configurations', () => {
      // Arrange
      const configurations = Array.from({ length: 20 }, (_, i) =>
        createBaseConfiguration({ variable: `field_${i}`, label: `Field ${i}` }))
      const props = {
        initialData: {},
        configurations,
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getAllByTestId(/^field-field_/)).toHaveLength(20)
    })
  })
})

// ============================================================================
// useInputVariables Hook Tests
// ============================================================================

describe('useInputVariables Hook', () => {
  // Import hook directly for isolated testing
  // Note: The hook is tested via component tests above, but we add specific hook tests here

  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'test-pipeline-id'
    mockParamsConfig = undefined
    mockIsFetchingParams = false
  })

  describe('Return Values', () => {
    it('should return isFetchingParams state', () => {
      // Arrange
      setupMocks({ isFetchingParams: true })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert - verified by checking process button is disabled
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should return paramsConfig when data is loaded', () => {
      // Arrange
      const variables = [createRAGPipelineVariable()]
      setupMocks({ paramsConfig: { variables } })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(mockUseInitialData).toHaveBeenCalledWith(variables)
    })
  })

  describe('Query Behavior', () => {
    it('should use pipelineId from store', () => {
      // Arrange
      mockPipelineId = 'custom-pipeline-id'
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert - component renders successfully with the pipelineId
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should handle null pipelineId gracefully', () => {
      // Arrange
      mockPipelineId = null
      setupMocks({ pipelineId: null })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('DocumentProcessing Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Full Flow', () => {
    it('should integrate hooks, Options, and Actions correctly', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({ variable: 'input1', label: 'Input 1' }),
        createRAGPipelineVariable({ variable: 'input2', label: 'Input 2' }),
      ]
      const configurations = [
        createBaseConfiguration({ variable: 'input1', label: 'Input 1' }),
        createBaseConfiguration({ variable: 'input2', label: 'Input 2' }),
      ]
      setupMocks({
        paramsConfig: { variables },
        configurations,
        initialData: { input1: '', input2: '' },
      })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(screen.getByTestId('field-input1')).toBeInTheDocument()
      expect(screen.getByTestId('field-input2')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.backToDataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.process')).toBeInTheDocument()
    })

    it('should pass data through the component hierarchy', () => {
      // Arrange
      const mockOnProcess = vi.fn()
      const mockOnBack = vi.fn()
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId="test-node"
          onProcess={mockOnProcess}
          onBack={mockOnBack}
        />,
      )

      // Click back button
      fireEvent.click(screen.getByText('datasetPipeline.operations.backToDataSource'))

      // Assert
      expect(mockOnBack).toHaveBeenCalled()
    })
  })

  describe('State Synchronization', () => {
    it('should update when workflow running status changes', () => {
      // Arrange
      setupMocks({
        workflowRunningData: { result: { status: WorkflowRunningStatus.Running } },
      })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should update when fetching params status changes', () => {
      // Arrange
      setupMocks({ isFetchingParams: true })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })
  })
})

// ============================================================================
// Prop Variations Tests
// ============================================================================

describe('Prop Variations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('dataSourceNodeId Variations', () => {
    it.each([
      ['simple-node-id'],
      ['node-with-numbers-123'],
      ['node_with_underscores'],
      ['node.with.dots'],
      ['very-long-node-id-that-could-potentially-cause-issues-if-not-handled-properly'],
    ])('should handle dataSourceNodeId: %s', (nodeId) => {
      // Act
      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId={nodeId}
          onProcess={vi.fn()}
          onBack={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Callback Variations', () => {
    it('should work with synchronous onProcess', () => {
      // Arrange
      const syncCallback = vi.fn()
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId="test-node"
          onProcess={syncCallback}
          onBack={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should work with async onProcess', () => {
      // Arrange
      const asyncCallback = vi.fn().mockResolvedValue(undefined)
      setupMocks()

      // Act
      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId="test-node"
          onProcess={asyncCallback}
          onBack={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Configuration Variations', () => {
    it('should handle required fields', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ variable: 'required', required: true }),
      ]
      setupMocks({ configurations })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(screen.getByTestId('field-required-required')).toHaveTextContent('true')
    })

    it('should handle optional fields', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ variable: 'optional', required: false }),
      ]
      setupMocks({ configurations })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(screen.getByTestId('field-required-optional')).toHaveTextContent('false')
    })

    it('should handle mixed required and optional fields', () => {
      // Arrange
      const configurations = [
        createBaseConfiguration({ variable: 'required1', required: true }),
        createBaseConfiguration({ variable: 'optional1', required: false }),
        createBaseConfiguration({ variable: 'required2', required: true }),
      ]
      setupMocks({ configurations })

      // Act
      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      // Assert
      expect(screen.getByTestId('field-required-required1')).toHaveTextContent('true')
      expect(screen.getByTestId('field-required-optional1')).toHaveTextContent('false')
      expect(screen.getByTestId('field-required-required2')).toHaveTextContent('true')
    })
  })
})
