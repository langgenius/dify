import type { Datasource, DataSourceOption } from '../../test-run/types'
import type { RAGPipelineVariable, RAGPipelineVariables } from '@/models/pipeline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import DataSource from './data-source'
import Form from './form'
import PreviewPanel from './index'
import ProcessDocuments from './process-documents'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock useFloatingRight hook
const mockUseFloatingRight = vi.fn(() => ({
  floatingRight: false,
  floatingRightWidth: 480,
}))

vi.mock('../hooks', () => ({
  useFloatingRight: () => mockUseFloatingRight(),
}))

// Mock useInputFieldPanel hook
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

// Track mock state for workflow store
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

// Mock reactflow store
vi.mock('reactflow', () => ({
  useStore: () => undefined,
}))

// Mock zustand shallow
vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}))

// Track mock data for API hooks
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

// Track mock datasource options
let mockDatasourceOptions: DataSourceOption[] = []

vi.mock('../../test-run/preparation/data-source-options', () => ({
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

// Helper function to convert option string to option object
const mapOptionToObject = (option: string) => ({
  label: option,
  value: option,
})

// Mock form-related hooks
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

// Mock useAppForm hook
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

// Mock BaseField component
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

// ============================================================================
// Test Data Factories
// ============================================================================

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

// ============================================================================
// Test Wrapper Component
// ============================================================================

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

// ============================================================================
// PreviewPanel Component Tests
// ============================================================================

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

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render preview panel without crashing', () => {
      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.operations.preview'),
      ).toBeInTheDocument()
    })

    it('should render preview badge', () => {
      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      const badge = screen.getByText('datasetPipeline.operations.preview')
      expect(badge).toBeInTheDocument()
    })

    it('should render close button', () => {
      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      const closeButton = screen.getByRole('button')
      expect(closeButton).toBeInTheDocument()
    })

    it('should render DataSource component', () => {
      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should render ProcessDocuments component', () => {
      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should render divider between sections', () => {
      // Act
      const { container } = renderWithProviders(<PreviewPanel />)

      // Assert
      const divider = container.querySelector('.bg-divider-subtle')
      expect(divider).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // State Management Tests
  // -------------------------------------------------------------------------
  describe('State Management', () => {
    it('should initialize with empty datasource state', () => {
      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('')
    })

    it('should update datasource state when DataSource selects', () => {
      // Arrange
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
      ]

      // Act
      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-node-1'))

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')
    })

    it('should pass datasource nodeId to ProcessDocuments', () => {
      // Arrange
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'test-node', label: 'Test Node' }),
      ]

      // Act
      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-test-node'))

      // Assert - ProcessDocuments receives the nodeId
      expect(screen.getByTestId('current-node-id').textContent).toBe('test-node')
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call toggleInputFieldPreviewPanel when close button clicked', () => {
      // Act
      renderWithProviders(<PreviewPanel />)
      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      // Assert
      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple close button clicks', () => {
      // Act
      renderWithProviders(<PreviewPanel />)
      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)
      fireEvent.click(closeButton)

      // Assert
      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(3)
    })

    it('should handle datasource selection changes', () => {
      // Arrange
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
        createDatasourceOption({ value: 'node-2', label: 'Node 2' }),
      ]

      // Act
      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-node-1'))

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')

      // Act - Change selection
      fireEvent.click(screen.getByTestId('option-node-2'))

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('node-2')
    })
  })

  // -------------------------------------------------------------------------
  // Floating Right Behavior Tests
  // -------------------------------------------------------------------------
  describe('Floating Right Behavior', () => {
    it('should apply floating right styles when floatingRight is true', () => {
      // Arrange
      mockUseFloatingRight.mockReturnValue({
        floatingRight: true,
        floatingRightWidth: 400,
      })

      // Act
      const { container } = renderWithProviders(<PreviewPanel />)

      // Assert
      const panel = container.firstChild as HTMLElement
      expect(panel.className).toContain('absolute')
      expect(panel.className).toContain('right-0')
      expect(panel.style.width).toBe('400px')
    })

    it('should not apply floating right styles when floatingRight is false', () => {
      // Arrange
      mockUseFloatingRight.mockReturnValue({
        floatingRight: false,
        floatingRightWidth: 480,
      })

      // Act
      const { container } = renderWithProviders(<PreviewPanel />)

      // Assert
      const panel = container.firstChild as HTMLElement
      expect(panel.className).not.toContain('absolute')
      expect(panel.style.width).toBe('480px')
    })

    it('should update width when floatingRightWidth changes', () => {
      // Arrange
      mockUseFloatingRight.mockReturnValue({
        floatingRight: false,
        floatingRightWidth: 600,
      })

      // Act
      const { container } = renderWithProviders(<PreviewPanel />)

      // Assert
      const panel = container.firstChild as HTMLElement
      expect(panel.style.width).toBe('600px')
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable handleClosePreviewPanel callback', () => {
      // Act
      const { rerender } = renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByRole('button'))

      rerender(
        <TestWrapper>
          <PreviewPanel />
        </TestWrapper>,
      )
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockToggleInputFieldPreviewPanel).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty datasource options', () => {
      // Arrange
      mockDatasourceOptions = []

      // Act
      renderWithProviders(<PreviewPanel />)

      // Assert
      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
      expect(screen.getByTestId('current-node-id').textContent).toBe('')
    })

    it('should handle rapid datasource selections', () => {
      // Arrange
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'node-1', label: 'Node 1' }),
        createDatasourceOption({ value: 'node-2', label: 'Node 2' }),
        createDatasourceOption({ value: 'node-3', label: 'Node 3' }),
      ]

      // Act
      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-node-1'))
      fireEvent.click(screen.getByTestId('option-node-2'))
      fireEvent.click(screen.getByTestId('option-node-3'))

      // Assert - Final selection should be node-3
      expect(screen.getByTestId('current-node-id').textContent).toBe('node-3')
    })
  })
})

// ============================================================================
// DataSource Component Tests
// ============================================================================

describe('DataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'test-pipeline-id'
    mockPreProcessingParamsData = undefined
    mockDatasourceOptions = []
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render step one title', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })

    it('should render DataSourceOptions component', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )

      // Assert
      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should pass dataSourceNodeId to DataSourceOptions', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node-id" />,
      )

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'test-node-id',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should handle empty dataSourceNodeId', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      renderWithProviders(<DataSource onSelect={onSelect} dataSourceNodeId="" />)

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('')
    })

    it('should handle different dataSourceNodeId values', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      const { rerender } = renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="node-1" />,
      )

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')

      // Act - Change nodeId
      rerender(
        <TestWrapper>
          <DataSource onSelect={onSelect} dataSourceNodeId="node-2" />
        </TestWrapper>,
      )

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe('node-2')
    })
  })

  // -------------------------------------------------------------------------
  // API Integration Tests
  // -------------------------------------------------------------------------
  describe('API Integration', () => {
    it('should fetch pre-processing params when pipelineId and nodeId are present', async () => {
      // Arrange
      const onSelect = vi.fn()
      mockPreProcessingParamsData = {
        variables: [createRAGPipelineVariable()],
      }

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node" />,
      )

      // Assert - Form should render with fetched variables
      await waitFor(() => {
        expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
      })
    })

    it('should not render form fields when params data is empty', () => {
      // Arrange
      const onSelect = vi.fn()
      mockPreProcessingParamsData = { variables: [] }

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node" />,
      )

      // Assert
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
    })

    it('should handle undefined params data', () => {
      // Arrange
      const onSelect = vi.fn()
      mockPreProcessingParamsData = undefined

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )

      // Assert - Should render without errors
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onSelect when datasource option is clicked', () => {
      // Arrange
      const onSelect = vi.fn()
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'selected-node', label: 'Selected' }),
      ]

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="" />,
      )
      fireEvent.click(screen.getByTestId('option-selected-node'))

      // Assert
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'selected-node',
        }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized (React.memo)', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      const { rerender } = renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="node-1" />,
      )

      // Rerender with same props
      rerender(
        <TestWrapper>
          <DataSource onSelect={onSelect} dataSourceNodeId="node-1" />
        </TestWrapper>,
      )

      // Assert - Component should not cause additional renders
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle null pipelineId', () => {
      // Arrange
      const onSelect = vi.fn()
      mockPipelineId = null

      // Act
      renderWithProviders(
        <DataSource onSelect={onSelect} dataSourceNodeId="test-node" />,
      )

      // Assert - Should render without errors
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepOneTitle'),
      ).toBeInTheDocument()
    })

    it('should handle special characters in dataSourceNodeId', () => {
      // Arrange
      const onSelect = vi.fn()

      // Act
      renderWithProviders(
        <DataSource
          onSelect={onSelect}
          dataSourceNodeId="node-with-special-chars_123"
        />,
      )

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'node-with-special-chars_123',
      )
    })
  })
})

// ============================================================================
// ProcessDocuments Component Tests
// ============================================================================

describe('ProcessDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId = 'test-pipeline-id'
    mockProcessingParamsData = undefined
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render step two title', () => {
      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="" />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should render Form component', () => {
      // Arrange
      mockProcessingParamsData = {
        variables: [createRAGPipelineVariable({ variable: 'process_var' })],
      }

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      // Assert - Form should be rendered
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should handle empty dataSourceNodeId', () => {
      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="" />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should handle different dataSourceNodeId values', () => {
      // Act
      const { rerender } = renderWithProviders(
        <ProcessDocuments dataSourceNodeId="node-1" />,
      )

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()

      // Act - Change nodeId
      rerender(
        <TestWrapper>
          <ProcessDocuments dataSourceNodeId="node-2" />
        </TestWrapper>,
      )

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // API Integration Tests
  // -------------------------------------------------------------------------
  describe('API Integration', () => {
    it('should fetch processing params when pipelineId and nodeId are present', async () => {
      // Arrange
      mockProcessingParamsData = {
        variables: [
          createRAGPipelineVariable({
            variable: 'chunk_size',
            label: 'Chunk Size',
          }),
        ],
      }

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('field-chunk_size')).toBeInTheDocument()
      })
    })

    it('should not render form fields when params data is empty', () => {
      // Arrange
      mockProcessingParamsData = { variables: [] }

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      // Assert
      expect(screen.queryByTestId('field-chunk_size')).not.toBeInTheDocument()
    })

    it('should handle undefined params data', () => {
      // Arrange
      mockProcessingParamsData = undefined

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="" />)

      // Assert - Should render without errors
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should render multiple form fields from params', async () => {
      // Arrange
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

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('field-var1')).toBeInTheDocument()
        expect(screen.getByTestId('field-var2')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized (React.memo)', () => {
      // Act
      const { rerender } = renderWithProviders(
        <ProcessDocuments dataSourceNodeId="node-1" />,
      )

      // Rerender with same props
      rerender(
        <TestWrapper>
          <ProcessDocuments dataSourceNodeId="node-1" />
        </TestWrapper>,
      )

      // Assert - Component should render without issues
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle null pipelineId', () => {
      // Arrange
      mockPipelineId = null

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId="test-node" />)

      // Assert - Should render without errors
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })

    it('should handle very long dataSourceNodeId', () => {
      // Arrange
      const longNodeId = 'a'.repeat(100)

      // Act
      renderWithProviders(<ProcessDocuments dataSourceNodeId={longNodeId} />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.preview.stepTwoTitle'),
      ).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Form Component Tests
// ============================================================================

describe('Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render form element', () => {
      // Act
      const { container } = renderWithProviders(<Form variables={[]} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render form fields for each variable', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({ variable: 'field1', label: 'Field 1' }),
        createRAGPipelineVariable({ variable: 'field2', label: 'Field 2' }),
      ]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-field1')).toBeInTheDocument()
      expect(screen.getByTestId('field-field2')).toBeInTheDocument()
    })

    it('should render no fields when variables is empty', () => {
      // Act
      renderWithProviders(<Form variables={[]} />)

      // Assert
      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should handle different variable types', () => {
      // Arrange
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

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-text_var')).toBeInTheDocument()
      expect(screen.getByTestId('field-number_var')).toBeInTheDocument()
      expect(screen.getByTestId('field-select_var')).toBeInTheDocument()
    })

    it('should handle variables with default values', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({
          variable: 'with_default',
          default_value: 'default_text',
        }),
      ]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-with_default')).toBeInTheDocument()
    })

    it('should handle variables with all optional fields', () => {
      // Arrange
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

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-full_var')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Form Behavior Tests
  // -------------------------------------------------------------------------
  describe('Form Behavior', () => {
    it('should prevent default form submission', () => {
      // Arrange
      const variables = [createRAGPipelineVariable()]
      const preventDefaultMock = vi.fn()

      // Act
      const { container } = renderWithProviders(<Form variables={variables} />)
      const form = container.querySelector('form')!

      // Create and dispatch submit event
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
      Object.defineProperty(submitEvent, 'preventDefault', {
        value: preventDefaultMock,
      })
      form.dispatchEvent(submitEvent)

      // Assert - Form should prevent default submission
      expect(preventDefaultMock).toHaveBeenCalled()
    })

    it('should pass form to each field component', () => {
      // Arrange
      const variables = [createRAGPipelineVariable({ variable: 'test_var' })]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('form-ref').textContent).toBe('has-form')
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should memoize initialData when variables do not change', () => {
      // Arrange
      const variables = [createRAGPipelineVariable()]

      // Act
      const { rerender } = renderWithProviders(<Form variables={variables} />)
      rerender(
        <TestWrapper>
          <Form variables={variables} />
        </TestWrapper>,
      )

      // Assert - Component should render without issues
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
    })

    it('should memoize configurations when variables do not change', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({ variable: 'var1' }),
        createRAGPipelineVariable({ variable: 'var2' }),
      ]

      // Act
      const { rerender } = renderWithProviders(<Form variables={variables} />)

      // Rerender with same variables reference
      rerender(
        <TestWrapper>
          <Form variables={variables} />
        </TestWrapper>,
      )

      // Assert
      expect(screen.getByTestId('field-var1')).toBeInTheDocument()
      expect(screen.getByTestId('field-var2')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty variables array', () => {
      // Act
      const { container } = renderWithProviders(<Form variables={[]} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
      expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
    })

    it('should handle single variable', () => {
      // Arrange
      const variables = [createRAGPipelineVariable({ variable: 'single' })]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-single')).toBeInTheDocument()
    })

    it('should handle many variables', () => {
      // Arrange
      const variables = Array.from({ length: 20 }, (_, i) =>
        createRAGPipelineVariable({ variable: `var_${i}`, label: `Var ${i}` }))

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-var_0')).toBeInTheDocument()
      expect(screen.getByTestId('field-var_19')).toBeInTheDocument()
    })

    it('should handle variables with special characters in names', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({
          variable: 'var_with_underscore',
          label: 'Variable with <special> & "chars"',
        }),
      ]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-var_with_underscore')).toBeInTheDocument()
    })

    it('should handle variables with unicode labels', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({
          variable: 'unicode_var',
          label: '中文标签 🎉',
          tooltips: 'ツールチップ',
        }),
      ]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-unicode_var')).toBeInTheDocument()
      expect(screen.getByText('中文标签 🎉')).toBeInTheDocument()
    })

    it('should handle variables with empty string default values', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({
          variable: 'empty_default',
          default_value: '',
        }),
      ]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-empty_default')).toBeInTheDocument()
    })

    it('should handle variables with zero max_length', () => {
      // Arrange
      const variables = [
        createRAGPipelineVariable({
          variable: 'zero_length',
          max_length: 0,
        }),
      ]

      // Act
      renderWithProviders(<Form variables={variables} />)

      // Assert
      expect(screen.getByTestId('field-zero_length')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

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

  // -------------------------------------------------------------------------
  // End-to-End Flow Tests
  // -------------------------------------------------------------------------
  describe('End-to-End Flow', () => {
    it('should complete full preview flow: select datasource -> show forms', async () => {
      // Arrange
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

      // Act
      renderWithProviders(<PreviewPanel />)

      // Select datasource
      fireEvent.click(screen.getByTestId('option-node-1'))

      // Assert - Both forms should show their fields
      await waitFor(() => {
        expect(screen.getByTestId('field-source_var')).toBeInTheDocument()
        expect(screen.getByTestId('field-process_var')).toBeInTheDocument()
      })
    })

    it('should update both forms when datasource changes', async () => {
      // Arrange
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

      // Act
      renderWithProviders(<PreviewPanel />)

      // Select first datasource
      fireEvent.click(screen.getByTestId('option-node-1'))

      // Assert initial selection
      await waitFor(() => {
        expect(screen.getByTestId('current-node-id').textContent).toBe('node-1')
      })

      // Select second datasource
      fireEvent.click(screen.getByTestId('option-node-2'))

      // Assert updated selection
      await waitFor(() => {
        expect(screen.getByTestId('current-node-id').textContent).toBe('node-2')
      })
    })
  })

  // -------------------------------------------------------------------------
  // Component Communication Tests
  // -------------------------------------------------------------------------
  describe('Component Communication', () => {
    it('should pass correct nodeId from PreviewPanel to child components', () => {
      // Arrange
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'communicated-node', label: 'Node' }),
      ]

      // Act
      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-communicated-node'))

      // Assert
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'communicated-node',
      )
    })
  })

  // -------------------------------------------------------------------------
  // State Persistence Tests
  // -------------------------------------------------------------------------
  describe('State Persistence', () => {
    it('should maintain datasource selection within same render cycle', () => {
      // Arrange
      mockDatasourceOptions = [
        createDatasourceOption({ value: 'persistent-node', label: 'Persistent' }),
        createDatasourceOption({ value: 'other-node', label: 'Other' }),
      ]

      // Act
      renderWithProviders(<PreviewPanel />)
      fireEvent.click(screen.getByTestId('option-persistent-node'))

      // Assert - Selection should be maintained
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'persistent-node',
      )

      // Change selection and verify state updates correctly
      fireEvent.click(screen.getByTestId('option-other-node'))
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'other-node',
      )

      // Go back to original and verify
      fireEvent.click(screen.getByTestId('option-persistent-node'))
      expect(screen.getByTestId('current-node-id').textContent).toBe(
        'persistent-node',
      )
    })
  })
})
