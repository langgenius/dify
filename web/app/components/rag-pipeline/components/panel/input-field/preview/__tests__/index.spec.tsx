import type { Datasource, DataSourceOption } from '../../../test-run/types'
import type { RAGPipelineVariable, RAGPipelineVariables } from '@/models/pipeline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import DataSource from '../data-source'
import Form from '../form'
import PreviewPanel from '../index'
import ProcessDocuments from '../process-documents'

const mockUseFloatingRight = vi.fn(() => ({
  floatingRight: false,
  floatingRightWidth: 480,
}))

vi.mock('../../hooks', () => ({
  useFloatingRight: () => mockUseFloatingRight(),
}))

const mockToggleInputFieldPreviewPanel = vi.fn()
vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    toggleInputFieldPreviewPanel: mockToggleInputFieldPreviewPanel,
    isPreviewing: true,
    isEditing: false,
    closeAllInputFieldPanels: vi.fn(),
    toggleInputFieldEditPanel: vi.fn(),
  }),
}))

let mockPipelineId: string | null = 'test-pipeline-id'

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      pipelineId: mockPipelineId,
      nodePanelWidth: 420,
      workflowCanvasWidth: 1200,
      otherPanelWidth: 0,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      showInputFieldPreviewPanel: true,
      setShowInputFieldPreviewPanel: vi.fn(),
    }),
  }),
}))

vi.mock('reactflow', () => ({
  useStore: () => undefined,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}))

let mockPreProcessingParamsData: { variables: RAGPipelineVariables } | undefined
let mockProcessingParamsData: { variables: RAGPipelineVariables } | undefined

vi.mock('@/service/use-pipeline', () => ({
  useDraftPipelinePreProcessingParams: (_params: unknown, enabled: boolean) => ({
    data: enabled ? mockPreProcessingParamsData : undefined,
    isLoading: false,
    error: null,
  }),
  useDraftPipelineProcessingParams: (_params: unknown, enabled: boolean) => ({
    data: enabled ? mockProcessingParamsData : undefined,
    isLoading: false,
    error: null,
  }),
}))

let mockDatasourceOptions: DataSourceOption[] = []

vi.mock('../../../test-run/preparation/data-source-options', () => ({
  default: ({
    onSelect,
    dataSourceNodeId,
  }: {
    onSelect: (datasource: Datasource) => void
    dataSourceNodeId: string
  }) => (
    <div data-testid="data-source-options">
      <span data-testid="current-node-id">{dataSourceNodeId}</span>
      {mockDatasourceOptions.map(option => (
        <button
          key={option.value}
          data-testid={`option-${option.value}`}
          onClick={() =>
            onSelect({
              nodeId: option.value,
              nodeData: option.data,
            })}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

const mapOptionToObject = (option: string) => ({
  label: option,
  value: option,
})

vi.mock('@/app/components/rag-pipeline/hooks/use-input-fields', () => ({
  useInitialData: (variables: RAGPipelineVariables) => {
    return React.useMemo(() => {
      return variables.reduce(
        (acc, item) => {
          acc[item.variable] = item.default_value ?? ''
          return acc
        },
        {} as Record<string, unknown>,
      )
    }, [variables])
  },
  useConfigurations: (variables: RAGPipelineVariables) => {
    return React.useMemo(() => {
      return variables.map(item => ({
        type: item.type,
        variable: item.variable,
        label: item.label,
        required: item.required,
        maxLength: item.max_length,
        options: item.options?.map(mapOptionToObject),
        showConditions: [],
        placeholder: item.placeholder,
        tooltip: item.tooltips,
        unit: item.unit,
      }))
    }, [variables])
  },
}))

vi.mock('@/app/components/base/form', () => ({
  useAppForm: ({ defaultValues }: { defaultValues: Record<string, unknown> }) => ({
    handleSubmit: vi.fn(),
    register: vi.fn(),
    formState: { errors: {} },
    watch: vi.fn(),
    setValue: vi.fn(),
    getValues: () => defaultValues,
    control: {},
  }),
}))

vi.mock('@/app/components/base/form/form-scenarios/base/field', () => ({
  default: ({ config }: { initialData: Record<string, unknown>, config: { variable: string, label: string } }) => {
    const FieldComponent = ({ form }: { form: unknown }) => (
      <div data-testid={`field-${config.variable}`}>
        <label>{config.label}</label>
        <input data-testid={`input-${config.variable}`} />
        <span data-testid="form-ref">{form ? 'has-form' : 'no-form'}</span>
      </div>
    )
    return FieldComponent
  },
}))

const createRAGPipelineVariable = (
  overrides?: Partial<RAGPipelineVariable>,
): RAGPipelineVariable => ({
  belong_to_node_id: 'node-1',
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  max_length: 256,
  default_value: '',
  placeholder: 'Enter value',
  required: true,
  tooltips: 'Help text',
  options: [],
  ...overrides,
})

const createDatasourceOption = (
  overrides?: Partial<DataSourceOption>,
): DataSourceOption => ({
  label: 'Test Datasource',
  value: 'datasource-node-1',
  data: {
    title: 'Test Datasource',
    desc: 'Test description',
  } as unknown as DataSourceOption['data'],
  ...overrides,
})

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper })
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFloatingRight.mockReturnValue({
      floatingRight: false,
      floatingRightWidth: 480,
    })
    mockPipelineId = 'test-pipeline-id'
    mockPreProcessingParamsData = undefined
    mockProcessingParamsData = undefined
    mockDatasourceOptions = []
  })

  describe('Rendering', () => {
    it('should render preview panel without crashing', () => {
      renderWithProviders(<PreviewPanel />)

      expect(
        screen.getByText('datasetPipeline.operations.preview'),
      ).toBeInTheDocument()
    })

    it('should render preview badge', () => {
      renderWithProviders(<PreviewPanel />)

      const badge = screen.getByText('datasetPipeline.operations.preview')
      expect(badge).toBeInTheDocument()
    })

    it('should render close button', () => {
      renderWithProviders(<PreviewPanel />)

      const closeButton = screen.getByRole('button')
      expect(closeButton).toBeInTheDocument()
    })

    it('should render DataSource component', () => {
      renderWithProviders(<PreviewPanel />)

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should render ProcessDocuments component', () => {
      renderWithProviders(<PreviewPanel />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should render divider between sections', () => {
      const { container } = renderWithProviders(<PreviewPanel />)

      const divider = container.querySelector('.bg-divider-subtle')
      expect(divider).toBeInTheDocument()
    })
  })

  describe('State Management', () => {
    it('should initialize with empty datasource state', () => {
      renderWithProviders(<PreviewPanel />)

      expect(screen.getByTestId('current-node-id').textContent).toBe('')
    })

    it('should update datasource state when DataSource selects', () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
      ]

      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-node-1'))

      expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')
    })

    it('should pass datasource nodeId to ProcessDocuments', () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'test-node', label: 'Test Node' }),
      ]

      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-test-node'))

      expect(screen.getByTestId('current-node-id').textContent).toBe('test-node')
    })
  })

  describe('User Interactions', () => {
    it('should call toggleInputFieldPreviewPanel when close button clicked', () => {
      renderWithProviders(<PreviewPanel />)
      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple close button clicks', () => {
      renderWithProviders(<PreviewPanel />)
      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)

      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(3)
    })

    it('should handle datasource selection changes', () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
        createDatasourceOption({ value: 'node-2', label: 'Node 2' }),
      ]

      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-node-1'))

      expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')

      fireEvent.click(screen.getByTestId('option-node-2'))

      expect(screen.getByTestId('current-node-id').textContent).toBe('node-2')
    })
  })

  describe('Floating Right Behavior', () => {
    it('should apply floating right styles when floatingRight is true', () => {
      mockUseFloatingRight.mockReturnValue({
        floatingRight: true,
        floatingRightWidth: 400,
      })

      const { container } = renderWithProviders(<PreviewPanel />)

      const panel = container.firstChild as HTMLElement
      expect(panel.className).toContain('absolute')
      expect(panel.className).toContain('right-0')
      expect(panel.style.width).toBe('400px')
    })

    it('should not apply floating right styles when floatingRight is false', () => {
      mockUseFloatingRight.mockReturnValue({
        floatingRight: false,
        floatingRightWidth: 480,
      })

      const { container } = renderWithProviders(<PreviewPanel />)

      const panel = container.firstChild as HTMLElement
      expect(panel.className).not.toContain('absolute')
      expect(panel.style.width).toBe('480px')
    })

    it('should update width when floatingRightWidth changes', () => {
      mockUseFloatingRight.mockReturnValue({
        floatingRight: false,
        floatingRightWidth: 600,
      })

      const { container } = renderWithProviders(<PreviewPanel />)

      const panel = container.firstChild as HTMLElement
      expect(panel.style.width).toBe('600px')
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable handleClosePreviewPanel callback', () => {
      const { rerender } = renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByRole('button'))

      rerender(
        <TestWrapper>
          <PreviewPanel />
        </TestWrapper>,
      )
      fireEvent.click(screen.getByRole('button'))

      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty datasource options', () => {
      mockDatasourceOptions = []

      renderWithProviders(<PreviewPanel />)

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
      expect(screen.getByTestId('current-node-id').textContent).toBe('')
    })

    it('should handle rapid datasource selections', () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
        createDatasourceOption({ value: 'node-2', label: 'Node 2' }),
        createDatasourceOption({ value: 'node-3', label: 'Node 3' }),
      ]

      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-node-1'))
      fireEvent.click(screen.getByTestId('option-node-2'))
      fireEvent.click(screen.getByTestId('option-node-3'))

      expect(screen.getByTestId('current-node-id').textContent).toBe('node-3')
    })
  })
})

describe('DataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'test-pipeline-id'
    mockPreProcessingParamsData = undefined
    mockDatasourceOptions = []
  })

  describe('Rendering', () => {
    it('should render step one title', () => {
      const onSelect = vi.fn()

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })

    it('should render DataSourceOptions component', () => {
      const onSelect = vi.fn()

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should pass dataSourceNodeId to DataSourceOptions', () => {
      const onSelect = vi.fn()

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node-id" />,
      )

      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'test-node-id',
      )
    })
  })

  describe('Props Variations', () => {
    it('should handle empty dataSourceNodeId', () => {
      const onSelect = vi.fn()

      renderWithProviders(<DataSource onSelect={onSelect} dataSourceNodeId="" />)

      expect(screen.getByTestId('current-node-id').textContent).toBe('')
    })

    it('should handle different dataSourceNodeId values', () => {
      const onSelect = vi.fn()

      const { rerender } = renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="node-1" />,
      )

      expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')

      rerender(
        <TestWrapper>
          <DataSource onSelect={onSelect} dataSourceNodeId="node-2" />
        </TestWrapper>,
      )

      expect(screen.getByTestId('current-node-id').textContent).toBe('node-2')
    })
  })

  describe('API Integration', () => {
    it('should fetch pre-processing params when pipelineId and nodeId are present', async () => {
      const onSelect = vi.fn()
      mockPreProcessingParamsData = {
        variables: [createRAGPipelineVariable()],
      }

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node" />,
      )

      await waitFor(() => {
        expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
      })
    })

    it('should not render form fields when params data is empty', () => {
      const onSelect = vi.fn()
      mockPreProcessingParamsData = { variables: [] }

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node" />,
      )

      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
    })

    it('should handle undefined params data', () => {
      const onSelect = vi.fn()
      mockPreProcessingParamsData = undefined

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect when datasource option is clicked', () => {
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'selected-node', label: 'Selected' }),
      ]

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )
      fireEvent.click(screen.getByTestId('option-selected-node'))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'selected-node',
        }),
      )
    })
  })

  describe('Memoization', () => {
    it('should be memoized (React.memo)', () => {
      const onSelect = vi.fn()

      const { rerender } = renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="node-1" />,
      )

      rerender(
        <TestWrapper>
          <DataSource onSelect={onSelect} dataSourceNodeId="node-1" />
        </TestWrapper>,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle null pipelineId', () => {
      const onSelect = vi.fn()
      mockPipelineId = null

      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node" />,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })

    it('should handle special characters in dataSourceNodeId', () => {
      const onSelect = vi.fn()

      renderWithProviders(
        <DataSource
          onSelect={onSelect}
          dataSourceNodeId="node-with-special-chars_123"
        />,
      )

      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'node-with-special-chars_123',
      )
    })
  })
})

describe('ProcessDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'test-pipeline-id'
    mockProcessingParamsData = undefined
  })

  describe('Rendering', () => {
    it('should render step two title', () => {
      renderWithProviders(<ProcessDocuments dataSourceNodeId="" />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should render Form component', () => {
      mockProcessingParamsData = {
        variables: [createRAGPipelineVariable({ variable: 'process_var' })],
      }

      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should handle empty dataSourceNodeId', () => {
      renderWithProviders(<ProcessDocuments dataSourceNodeId="" />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should handle different dataSourceNodeId values', () => {
      const { rerender } = renderWithProviders(
        <ProcessDocuments dataSourceNodeId="node-1" />,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()

      rerender(
        <TestWrapper>
          <ProcessDocuments dataSourceNodeId="node-2" />
        </TestWrapper>,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })

  describe('API Integration', () => {
    it('should fetch processing params when pipelineId and nodeId are present', async () => {
      mockProcessingParamsData = {
        variables: [
          createRAGPipelineVariable({
            variable: 'chunk_size',
            label: 'Chunk Size',
          }),
        ],
      }

      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      await waitFor(() => {
        expect(screen.getByTestId('field-chunk_size')).toBeInTheDocument()
      })
    })

    it('should not render form fields when params data is empty', () => {
      mockProcessingParamsData = { variables: [] }

      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      expect(screen.queryByTestId('field-chunk_size')).not.toBeInTheDocument()
    })

    it('should handle undefined params data', () => {
      mockProcessingParamsData = undefined

      renderWithProviders(<ProcessDocuments dataSourceNodeId="" />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should render multiple form fields from params', async () => {
      mockProcessingParamsData = {
        variables: [
          createRAGPipelineVariable({
            variable: 'var1',
            label: 'Variable 1',
          }),
          createRAGPipelineVariable({
            variable: 'var2',
            label: 'Variable 2',
          }),
        ],
      }

      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      await waitFor(() => {
        expect(screen.getByTestId('field-var1')).toBeInTheDocument()
        expect(screen.getByTestId('field-var2')).toBeInTheDocument()
      })
    })
  })

  describe('Memoization', () => {
    it('should be memoized (React.memo)', () => {
      const { rerender } = renderWithProviders(
        <ProcessDocuments dataSourceNodeId="node-1" />,
      )

      rerender(
        <TestWrapper>
          <ProcessDocuments dataSourceNodeId="node-1" />
        </TestWrapper>,
      )

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle null pipelineId', () => {
      mockPipelineId = null

      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should handle very long dataSourceNodeId', () => {
      const longNodeId = 'a'.repeat(100)

      renderWithProviders(<ProcessDocuments dataSourceNodeId={longNodeId} />)

      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })
})

describe('Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render form element', () => {
      const { container } = renderWithProviders(<Form variables={[]} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render form fields for each variable', () => {
      const variables = [
        createRAGPipelineVariable({ variable: 'field1', label: 'Field 1' }),
        createRAGPipelineVariable({ variable: 'field2', label: 'Field 2' }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-field1')).toBeInTheDocument()
      expect(screen.getByTestId('field-field2')).toBeInTheDocument()
    })

    it('should render no fields when variables is empty', () => {
      renderWithProviders(<Form variables={[]} />)

      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should handle different variable types', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'text_var',
          type: PipelineInputVarType.textInput,
        }),
        createRAGPipelineVariable({
          variable: 'number_var',
          type: PipelineInputVarType.number,
        }),
        createRAGPipelineVariable({
          variable: 'select_var',
          type: PipelineInputVarType.select,
          options: ['opt1', 'opt2'],
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-text_var')).toBeInTheDocument()
      expect(screen.getByTestId('field-number_var')).toBeInTheDocument()
      expect(screen.getByTestId('field-select_var')).toBeInTheDocument()
    })

    it('should handle variables with default values', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'with_default',
          default_value: 'default_text',
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-with_default')).toBeInTheDocument()
    })

    it('should handle variables with all optional fields', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'full_var',
          label: 'Full Variable',
          max_length: 1000,
          default_value: 'default',
          placeholder: 'Enter here',
          required: true,
          tooltips: 'This is a tooltip',
          unit: 'units',
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-full_var')).toBeInTheDocument()
    })
  })

  describe('Form Behavior', () => {
    it('should prevent default form submission', () => {
      const variables = [createRAGPipelineVariable()]
      const preventDefaultMock = vi.fn()

      const { container } = renderWithProviders(<Form variables={variables} />)
      const form = container.querySelector('form')!

      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
      Object.defineProperty(submitEvent, 'preventDefault', {
        value: preventDefaultMock,
      })
      form.dispatchEvent(submitEvent)

      expect(preventDefaultMock).toHaveBeenCalled()
    })

    it('should pass form to each field component', () => {
      const variables = [createRAGPipelineVariable({ variable: 'test_var' })]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('form-ref').textContent).toBe('has-form')
    })
  })

  describe('Memoization', () => {
    it('should memoize initialData when variables do not change', () => {
      const variables = [createRAGPipelineVariable()]

      const { rerender } = renderWithProviders(<Form variables={variables} />)
      rerender(
        <TestWrapper>
          <Form variables={variables} />
        </TestWrapper>,
      )

      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
    })

    it('should memoize configurations when variables do not change', () => {
      const variables = [
        createRAGPipelineVariable({ variable: 'var1' }),
        createRAGPipelineVariable({ variable: 'var2' }),
      ]

      const { rerender } = renderWithProviders(<Form variables={variables} />)

      rerender(
        <TestWrapper>
          <Form variables={variables} />
        </TestWrapper>,
      )

      expect(screen.getByTestId('field-var1')).toBeInTheDocument()
      expect(screen.getByTestId('field-var2')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty variables array', () => {
      const { container } = renderWithProviders(<Form variables={[]} />)

      expect(container.querySelector('form')).toBeInTheDocument()
      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })

    it('should handle single variable', () => {
      const variables = [createRAGPipelineVariable({ variable: 'single' })]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-single')).toBeInTheDocument()
    })

    it('should handle many variables', () => {
      const variables = Array.from({ length: 20 }, (_, i) =>
        createRAGPipelineVariable({ variable: `var_${i}`, label: `Var ${i}` }))

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-var_0')).toBeInTheDocument()
      expect(screen.getByTestId('field-var_19')).toBeInTheDocument()
    })

    it('should handle variables with special characters in names', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'var_with_underscore',
          label: 'Variable with <special> & "chars"',
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-var_with_underscore')).toBeInTheDocument()
    })

    it('should handle variables with unicode labels', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'unicode_var',
          label: '中文标签 🎉',
          tooltips: 'ツールチップ',
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-unicode_var')).toBeInTheDocument()
      expect(screen.getByText('中文标签 🎉')).toBeInTheDocument()
    })

    it('should handle variables with empty string default values', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'empty_default',
          default_value: '',
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-empty_default')).toBeInTheDocument()
    })

    it('should handle variables with zero max_length', () => {
      const variables = [
        createRAGPipelineVariable({
          variable: 'zero_length',
          max_length: 0,
        }),
      ]

      renderWithProviders(<Form variables={variables} />)

      expect(screen.getByTestId('field-zero_length')).toBeInTheDocument()
    })
  })
})

describe('Preview Panel Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFloatingRight.mockReturnValue({
      floatingRight: false,
      floatingRightWidth: 480,
    })
    mockPipelineId = 'test-pipeline-id'
    mockPreProcessingParamsData = undefined
    mockProcessingParamsData = undefined
    mockDatasourceOptions = []
  })

  describe('End-to-End Flow', () => {
    it('should complete full preview flow: select datasource -> show forms', async () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Local File' }),
      ]
      mockPreProcessingParamsData = {
        variables: [
          createRAGPipelineVariable({
            variable: 'source_var',
            label: 'Source Variable',
          }),
        ],
      }
      mockProcessingParamsData = {
        variables: [
          createRAGPipelineVariable({
            variable: 'process_var',
            label: 'Process Variable',
          }),
        ],
      }

      renderWithProviders(<PreviewPanel />)

      fireEvent.click(screen.getByTestId('option-node-1'))

      await waitFor(() => {
        expect(screen.getByTestId('field-source_var')).toBeInTheDocument()
        expect(screen.getByTestId('field-process_var')).toBeInTheDocument()
      })
    })

    it('should update both forms when datasource changes', async () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
        createDatasourceOption({ value: 'node-2', label: 'Node 2' }),
      ]
      mockPreProcessingParamsData = {
        variables: [createRAGPipelineVariable({ variable: 'pre_var' })],
      }
      mockProcessingParamsData = {
        variables: [createRAGPipelineVariable({ variable: 'proc_var' })],
      }

      renderWithProviders(<PreviewPanel />)

      fireEvent.click(screen.getByTestId('option-node-1'))

      await waitFor(() => {
        expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')
      })

      fireEvent.click(screen.getByTestId('option-node-2'))

      await waitFor(() => {
        expect(screen.getByTestId('current-node-id').textContent).toBe('node-2')
      })
    })
  })

  describe('Component Communication', () => {
    it('should pass correct nodeId from PreviewPanel to child components', () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'communicated-node', label: 'Node' }),
      ]

      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-communicated-node'))

      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'communicated-node',
      )
    })
  })

  describe('State Persistence', () => {
    it('should maintain datasource selection within same render cycle', () => {
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'persistent-node', label: 'Persistent' }),
        createDatasourceOption({ value: 'other-node', label: 'Other' }),
      ]

      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-persistent-node'))

      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'persistent-node',
      )

      fireEvent.click(screen.getByTestId('option-other-node'))
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'other-node',
      )

      fireEvent.click(screen.getByTestId('option-persistent-node'))
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'persistent-node',
      )
    })
  })
})
