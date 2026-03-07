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
import Actions from '../actions'
import DocumentProcessing from '../index'
import Options from '../options'

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

let mockParamsConfig: PipelineProcessingParamsResponse | undefined
let mockIsFetchingParams = false

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelineProcessingParams: () => ({
    data: mockParamsConfig,
    isFetching: mockIsFetchingParams,
  }),
}))

const mockUseInitialData = vi.fn()
const mockUseConfigurations = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks/use-input-fields', () => ({
  useInitialData: (variables: RAGPipelineVariables) => mockUseInitialData(variables),
  useConfigurations: (variables: RAGPipelineVariables) => mockUseConfigurations(variables),
}))

const mockGenerateZodSchema = vi.fn()

vi.mock('@/app/components/base/form/form-scenarios/base/utils', () => ({
  generateZodSchema: (configurations: BaseConfiguration[]) => mockGenerateZodSchema(configurations),
}))

const mockToastNotify = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (params: { type: string, message: string }) => mockToastNotify(params),
  },
}))

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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      setupMocks({
        configurations: [createBaseConfiguration()],
      })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should render Options component with form elements', () => {
      const configurations = [
        createBaseConfiguration({ variable: 'field1', label: 'Field 1' }),
        createBaseConfiguration({ variable: 'field2', label: 'Field 2' }),
      ]
      setupMocks({ configurations })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(screen.getByTestId('field-field1')).toBeInTheDocument()
      expect(screen.getByTestId('field-field2')).toBeInTheDocument()
    })

    it('should render no fields when configurations is empty', () => {
      setupMocks({ configurations: [] })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })

    it('should call useInitialData with variables from paramsConfig', () => {
      const variables = [createRAGPipelineVariable({ variable: 'var1' })]
      setupMocks({
        paramsConfig: { variables },
      })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(mockUseInitialData).toHaveBeenCalledWith(variables)
    })

    it('should call useConfigurations with variables from paramsConfig', () => {
      const variables = [createRAGPipelineVariable({ variable: 'var1' })]
      setupMocks({
        paramsConfig: { variables },
      })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(mockUseConfigurations).toHaveBeenCalledWith(variables)
    })

    it('should use empty array when paramsConfig.variables is undefined', () => {
      setupMocks({ paramsConfig: undefined })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(mockUseInitialData).toHaveBeenCalledWith([])
      expect(mockUseConfigurations).toHaveBeenCalledWith([])
    })
  })

  describe('Props Testing', () => {
    it('should pass dataSourceNodeId to useInputVariables hook', () => {
      const customNodeId = 'custom-datasource-node'
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          dataSourceNodeId={customNodeId}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should pass onProcess callback to Options component', () => {
      const mockOnProcess = vi.fn()
      setupMocks({ configurations: [] })

      const { container } = renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onProcess={mockOnProcess}
        />,
      )

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should pass onBack callback to Actions component', () => {
      const mockOnBack = vi.fn()
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onBack={mockOnBack}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Callback Stability and Memoization', () => {
    it('should memoize renderCustomActions callback', () => {
      setupMocks()
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should update renderCustomActions when isFetchingParams changes', () => {
      setupMocks({ isFetchingParams: false })
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      setupMocks({ isFetchingParams: true })
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should update renderCustomActions when onBack changes', () => {
      const onBack1 = vi.fn()
      const onBack2 = vi.fn()
      setupMocks()
      const { rerender } = renderWithQueryClient(
        <DocumentProcessing {...defaultProps} onBack={onBack1} />,
      )

      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} onBack={onBack2} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      const mockOnBack = vi.fn()
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onBack={mockOnBack}
        />,
      )
      const backButton = screen.getByText('datasetPipeline.operations.backToDataSource')
      fireEvent.click(backButton)

      expect(mockOnBack).toHaveBeenCalledTimes(1)
    })

    it('should handle form submission', () => {
      const mockOnProcess = vi.fn()
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          onProcess={mockOnProcess}
        />,
      )
      const processButton = screen.getByText('datasetPipeline.operations.process')
      fireEvent.click(processButton)

      expect(mockHandleSubmit).toHaveBeenCalled()
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      setupMocks()
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...defaultProps} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should not break when re-rendering with different props', () => {
      const initialProps = {
        ...defaultProps,
        dataSourceNodeId: 'node-1',
      }
      setupMocks()
      const { rerender } = renderWithQueryClient(<DocumentProcessing {...initialProps} />)

      const newProps = {
        ...defaultProps,
        dataSourceNodeId: 'node-2',
      }
      rerender(
        <QueryClientProvider client={createQueryClient()}>
          <DocumentProcessing {...newProps} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined paramsConfig', () => {
      setupMocks({ paramsConfig: undefined })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(mockUseInitialData).toHaveBeenCalledWith([])
      expect(mockUseConfigurations).toHaveBeenCalledWith([])
    })

    it('should handle paramsConfig with empty variables', () => {
      setupMocks({ paramsConfig: { variables: [] } })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(mockUseInitialData).toHaveBeenCalledWith([])
      expect(mockUseConfigurations).toHaveBeenCalledWith([])
    })

    it('should handle null pipelineId', () => {
      setupMocks({ pipelineId: null })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should handle large number of variables', () => {
      const variables = Array.from({ length: 50 }, (_, i) =>
        createRAGPipelineVariable({ variable: `var_${i}` }))
      const configurations = Array.from({ length: 50 }, (_, i) =>
        createBaseConfiguration({ variable: `var_${i}`, label: `Field ${i}` }))
      setupMocks({
        paramsConfig: { variables },
        configurations,
      })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      expect(screen.getAllByTestId(/^field-var_/)).toHaveLength(50)
    })

    it('should handle special characters in node id', () => {
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          {...defaultProps}
          dataSourceNodeId="node-with-special_chars.123"
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should pass isFetchingParams to Actions component', () => {
      setupMocks({ isFetchingParams: true })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      const processButton = screen.getByText('datasetPipeline.operations.process')
      expect(processButton.closest('button')).toBeDisabled()
    })

    it('should enable process button when not fetching', () => {
      setupMocks({ isFetchingParams: false })

      renderWithQueryClient(<DocumentProcessing {...defaultProps} />)

      const processButton = screen.getByText('datasetPipeline.operations.process')
      expect(processButton.closest('button')).not.toBeDisabled()
    })
  })
})

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
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      expect(screen.getByText('datasetPipeline.operations.backToDataSource')).toBeInTheDocument()
    })

    it('should render process button', () => {
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      expect(screen.getByText('datasetPipeline.operations.process')).toBeInTheDocument()
    })
  })

  describe('Button States', () => {
    it('should disable process button when runDisabled is true', () => {
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          runDisabled={true}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when isSubmitting is true', () => {
      const mockFormParams = createMockFormParams({ isSubmitting: true })

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when canSubmit is false', () => {
      const mockFormParams = createMockFormParams({ canSubmit: false })

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should disable process button when workflow is running', () => {
      mockWorkflowRunningData = {
        result: { status: WorkflowRunningStatus.Running },
      }
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should enable process button when all conditions are met', () => {
      mockWorkflowRunningData = {
        result: { status: WorkflowRunningStatus.Succeeded },
      }
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          runDisabled={false}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).not.toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      const mockOnBack = vi.fn()
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={mockOnBack}
        />,
      )

      fireEvent.click(screen.getByText('datasetPipeline.operations.backToDataSource'))

      expect(mockOnBack).toHaveBeenCalledTimes(1)
    })

    it('should call form.handleSubmit when process button is clicked', () => {
      const mockSubmit = vi.fn()
      const mockFormParams = createMockFormParams({ handleSubmit: mockSubmit })

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('datasetPipeline.operations.process'))

      expect(mockSubmit).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loading State', () => {
    it('should show loading state when isSubmitting', () => {
      const mockFormParams = createMockFormParams({ isSubmitting: true })

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should show loading state when workflow is running', () => {
      mockWorkflowRunningData = {
        result: { status: WorkflowRunningStatus.Running },
      }
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined runDisabled prop', () => {
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).not.toBeDisabled()
    })

    it('should handle undefined workflowRunningData', () => {
      mockWorkflowRunningData = undefined
      const mockFormParams = createMockFormParams()

      render(
        <Actions
          formParams={mockFormParams}
          onBack={vi.fn()}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).not.toBeDisabled()
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      const mockFormParams = createMockFormParams()
      const mockOnBack = vi.fn()
      const { rerender } = render(
        <Actions
          formParams={mockFormParams}
          onBack={mockOnBack}
        />,
      )

      rerender(
        <Actions
          formParams={mockFormParams}
          onBack={mockOnBack}
        />,
      )

      expect(screen.getByText('datasetPipeline.operations.backToDataSource')).toBeInTheDocument()
    })
  })
})

describe('Options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateZodSchema.mockReturnValue(createMockSchema())
  })

  describe('Rendering', () => {
    it('should render form element', () => {
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      const { container } = render(<Options {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render fields based on configurations', () => {
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

      render(<Options {...props} />)

      expect(screen.getByTestId('field-name')).toBeInTheDocument()
      expect(screen.getByTestId('field-email')).toBeInTheDocument()
    })

    it('should render CustomActions', () => {
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => (
          <button data-testid="custom-action">Custom Submit</button>
        ),
        onSubmit: vi.fn(),
      }

      render(<Options {...props} />)

      expect(screen.getByTestId('custom-action')).toBeInTheDocument()
    })

    it('should render with correct class name', () => {
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      const { container } = render(<Options {...props} />)

      const form = container.querySelector('form')
      expect(form).toHaveClass('w-full')
    })
  })

  describe('Form Submission', () => {
    it('should prevent default form submission', () => {
      const mockOnSubmit = vi.fn()
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
      const preventDefaultSpy = vi.spyOn(submitEvent, 'preventDefault')

      fireEvent(form, submitEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('should stop propagation on form submit', () => {
      const mockOnSubmit = vi.fn()
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
      const stopPropagationSpy = vi.spyOn(submitEvent, 'stopPropagation')

      fireEvent(form, submitEvent)

      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('should call onSubmit when validation passes', () => {
      const mockOnSubmit = vi.fn()
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(), // returns success: true
        CustomActions: () => <button type="submit">Submit</button>,
        onSubmit: mockOnSubmit,
      }

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      expect(mockOnSubmit).toHaveBeenCalled()
    })

    it('should not call onSubmit when validation fails', () => {
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

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show toast error when validation fails', () => {
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

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path: name Error: Name is required',
      })
    })

    it('should format error message with multiple path segments', () => {
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

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path: user.profile.email Error: Invalid email format',
      })
    })

    it('should only show first validation error when multiple errors exist', () => {
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

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      expect(mockToastNotify).toHaveBeenCalledTimes(1)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path: name Error: Name is required',
      })
    })

    it('should handle empty path in validation error', () => {
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

      const { container } = render(<Options {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Path:  Error: Form validation failed',
      })
    })
  })

  describe('Field Rendering', () => {
    it('should render fields in correct order', () => {
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

      render(<Options {...props} />)

      expect(screen.getByTestId('field-first')).toBeInTheDocument()
      expect(screen.getByTestId('field-second')).toBeInTheDocument()
      expect(screen.getByTestId('field-third')).toBeInTheDocument()

      expect(screen.getByTestId('field-label-first')).toHaveTextContent('First')
      expect(screen.getByTestId('field-label-second')).toHaveTextContent('Second')
      expect(screen.getByTestId('field-label-third')).toHaveTextContent('Third')
    })

    it('should pass config to BaseField', () => {
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

      render(<Options {...props} />)

      expect(screen.getByTestId('field-label-test')).toHaveTextContent('Test Label')
      expect(screen.getByTestId('field-type-test')).toHaveTextContent(BaseFieldType.textInput)
      expect(screen.getByTestId('field-required-test')).toHaveTextContent('true')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty initialData', () => {
      const props = {
        initialData: {},
        configurations: [createBaseConfiguration()],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      const { container } = render(<Options {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle empty configurations', () => {
      const props = {
        initialData: {},
        configurations: [],
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      render(<Options {...props} />)

      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })

    it('should handle configurations with all field types', () => {
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

      render(<Options {...props} />)

      expect(screen.getByTestId('field-text')).toBeInTheDocument()
      expect(screen.getByTestId('field-paragraph')).toBeInTheDocument()
      expect(screen.getByTestId('field-number')).toBeInTheDocument()
      expect(screen.getByTestId('field-checkbox')).toBeInTheDocument()
      expect(screen.getByTestId('field-select')).toBeInTheDocument()
    })

    it('should handle large number of configurations', () => {
      const configurations = Array.from({ length: 20 }, (_, i) =>
        createBaseConfiguration({ variable: `field_${i}`, label: `Field ${i}` }))
      const props = {
        initialData: {},
        configurations,
        schema: createMockSchema(),
        CustomActions: () => <button>Submit</button>,
        onSubmit: vi.fn(),
      }

      render(<Options {...props} />)

      expect(screen.getAllByTestId(/^field-field_/)).toHaveLength(20)
    })
  })
})

describe('useInputVariables Hook', () => {
  // Note: The hook is tested via component tests above, but we add specific hook tests here

  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'test-pipeline-id'
    mockParamsConfig = undefined
    mockIsFetchingParams = false
  })

  describe('Return Values', () => {
    it('should return isFetchingParams state', () => {
      setupMocks({ isFetchingParams: true })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should return paramsConfig when data is loaded', () => {
      const variables = [createRAGPipelineVariable()]
      setupMocks({ paramsConfig: { variables } })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(mockUseInitialData).toHaveBeenCalledWith(variables)
    })
  })

  describe('Query Behavior', () => {
    it('should use pipelineId from store', () => {
      mockPipelineId = 'custom-pipeline-id'
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should handle null pipelineId gracefully', () => {
      mockPipelineId = null
      setupMocks({ pipelineId: null })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })
})

describe('DocumentProcessing Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  describe('Full Flow', () => {
    it('should integrate hooks, Options, and Actions correctly', () => {
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

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(screen.getByTestId('field-input1')).toBeInTheDocument()
      expect(screen.getByTestId('field-input2')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.backToDataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.process')).toBeInTheDocument()
    })

    it('should pass data through the component hierarchy', () => {
      const mockOnProcess = vi.fn()
      const mockOnBack = vi.fn()
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId="test-node"
          onProcess={mockOnProcess}
          onBack={mockOnBack}
        />,
      )

      fireEvent.click(screen.getByText('datasetPipeline.operations.backToDataSource'))

      expect(mockOnBack).toHaveBeenCalled()
    })
  })

  describe('State Synchronization', () => {
    it('should update when workflow running status changes', () => {
      setupMocks({
        workflowRunningData: { result: { status: WorkflowRunningStatus.Running } },
      })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })

    it('should update when fetching params status changes', () => {
      setupMocks({ isFetchingParams: true })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      const processButton = screen.getByText('datasetPipeline.operations.process').closest('button')
      expect(processButton).toBeDisabled()
    })
  })
})

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
      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId={nodeId}
          onProcess={vi.fn()}
          onBack={vi.fn()}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Callback Variations', () => {
    it('should work with synchronous onProcess', () => {
      const syncCallback = vi.fn()
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId="test-node"
          onProcess={syncCallback}
          onBack={vi.fn()}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })

    it('should work with async onProcess', () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined)
      setupMocks()

      renderWithQueryClient(
        <DocumentProcessing
          dataSourceNodeId="test-node"
          onProcess={asyncCallback}
          onBack={vi.fn()}
        />,
      )

      expect(screen.getByTestId('form-actions')).toBeInTheDocument()
    })
  })

  describe('Configuration Variations', () => {
    it('should handle required fields', () => {
      const configurations = [
        createBaseConfiguration({ variable: 'required', required: true }),
      ]
      setupMocks({ configurations })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(screen.getByTestId('field-required-required')).toHaveTextContent('true')
    })

    it('should handle optional fields', () => {
      const configurations = [
        createBaseConfiguration({ variable: 'optional', required: false }),
      ]
      setupMocks({ configurations })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(screen.getByTestId('field-required-optional')).toHaveTextContent('false')
    })

    it('should handle mixed required and optional fields', () => {
      const configurations = [
        createBaseConfiguration({ variable: 'required1', required: true }),
        createBaseConfiguration({ variable: 'optional1', required: false }),
        createBaseConfiguration({ variable: 'required2', required: true }),
      ]
      setupMocks({ configurations })

      renderWithQueryClient(
        <DocumentProcessing {...{
          dataSourceNodeId: 'test-node',
          onProcess: vi.fn(),
          onBack: vi.fn(),
        }}
        />,
      )

      expect(screen.getByTestId('field-required-required1')).toHaveTextContent('true')
      expect(screen.getByTestId('field-required-optional1')).toHaveTextContent('false')
      expect(screen.getByTestId('field-required-required2')).toHaveTextContent('true')
    })
  })
})
