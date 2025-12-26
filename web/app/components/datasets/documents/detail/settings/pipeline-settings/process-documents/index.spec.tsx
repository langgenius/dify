import type { RAGPipelineVariable } from '@/models/pipeline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import ProcessDocuments from './index'

// Mock dataset detail context - required for useInputVariables hook
const mockPipelineId = 'pipeline-123'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: { pipeline_id: string } }) => string) =>
    selector({ dataset: { pipeline_id: mockPipelineId } }),
}))

// Mock API call for pipeline processing params
const mockParamsConfig = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePublishedPipelineProcessingParams: () => ({
    data: mockParamsConfig(),
    isFetching: false,
  }),
}))

// Mock Form component - internal dependencies (useAppForm, BaseField) are too complex
// Keep the mock minimal and focused on testing the integration
vi.mock('../../../../create-from-pipeline/process-documents/form', () => ({
  default: function MockForm({
    ref,
    initialData,
    configurations,
    onSubmit,
    onPreview,
    isRunning,
  }: {
    ref: React.RefObject<{ submit: () => void }>
    initialData: Record<string, unknown>
    configurations: Array<{ variable: string, label: string, type: string }>
    schema: unknown
    onSubmit: (data: Record<string, unknown>) => void
    onPreview: () => void
    isRunning: boolean
  }) {
    // Expose submit method via ref for parent component control
    if (ref && typeof ref === 'object' && 'current' in ref) {
      (ref as React.MutableRefObject<{ submit: () => void }>).current = {
        submit: () => onSubmit(initialData),
      }
    }
    return (
      <form
        data-testid="process-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(initialData)
        }}
      >
        {/* Render actual field labels from configurations */}
        {configurations.map((config, index) => (
          <div key={index} data-testid={`field-${config.variable}`}>
            <label>{config.label}</label>
            <input
              name={config.variable}
              defaultValue={String(initialData[config.variable] ?? '')}
              data-testid={`input-${config.variable}`}
            />
          </div>
        ))}
        <button type="button" data-testid="preview-btn" onClick={onPreview} disabled={isRunning}>
          Preview
        </button>
      </form>
    )
  },
}))

// Test utilities
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

// Factory function for creating mock variables - matches RAGPipelineVariable type
const createMockVariable = (overrides: Partial<RAGPipelineVariable> = {}): RAGPipelineVariable => ({
  belong_to_node_id: 'node-123',
  type: PipelineInputVarType.textInput,
  variable: 'test_var',
  label: 'Test Variable',
  required: false,
  ...overrides,
})

// Default props factory
const createDefaultProps = (overrides: Partial<{
  datasourceNodeId: string
  lastRunInputData: Record<string, unknown>
  isRunning: boolean
  ref: React.RefObject<{ submit: () => void } | null>
  onProcess: () => void
  onPreview: () => void
  onSubmit: (data: Record<string, unknown>) => void
}> = {}) => ({
  datasourceNodeId: 'node-123',
  lastRunInputData: {},
  isRunning: false,
  ref: { current: null } as React.RefObject<{ submit: () => void } | null>,
  onProcess: vi.fn(),
  onPreview: vi.fn(),
  onSubmit: vi.fn(),
  ...overrides,
})

describe('ProcessDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: return empty variables
    mockParamsConfig.mockReturnValue({ variables: [] })
  })

  // ==================== Rendering Tests ====================
  // Test basic rendering and component structure
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert - verify both Form and Actions are rendered
      expect(screen.getByTestId('process-form')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' })).toBeInTheDocument()
    })

    it('should render with correct container structure', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = renderWithProviders(<ProcessDocuments {...props} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'flex-col', 'gap-y-4', 'pt-4')
    })

    it('should render form fields based on variables configuration', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'chunk_size', label: 'Chunk Size', type: PipelineInputVarType.number }),
        createMockVariable({ variable: 'separator', label: 'Separator', type: PipelineInputVarType.textInput }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert - real hooks transform variables to configurations
      expect(screen.getByTestId('field-chunk_size')).toBeInTheDocument()
      expect(screen.getByTestId('field-separator')).toBeInTheDocument()
      expect(screen.getByText('Chunk Size')).toBeInTheDocument()
      expect(screen.getByText('Separator')).toBeInTheDocument()
    })
  })

  // ==================== Props Testing ====================
  // Test how component behaves with different prop values
  describe('Props', () => {
    describe('lastRunInputData', () => {
      it('should use lastRunInputData as initial form values', () => {
        // Arrange
        const variables: RAGPipelineVariable[] = [
          createMockVariable({ variable: 'chunk_size', label: 'Chunk Size', type: PipelineInputVarType.number, default_value: '100' }),
        ]
        mockParamsConfig.mockReturnValue({ variables })
        const lastRunInputData = { chunk_size: 500 }
        const props = createDefaultProps({ lastRunInputData })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert - lastRunInputData should override default_value
        const input = screen.getByTestId('input-chunk_size') as HTMLInputElement
        expect(input.defaultValue).toBe('500')
      })

      it('should use default_value when lastRunInputData is empty', () => {
        // Arrange
        const variables: RAGPipelineVariable[] = [
          createMockVariable({ variable: 'chunk_size', label: 'Chunk Size', type: PipelineInputVarType.number, default_value: '100' }),
        ]
        mockParamsConfig.mockReturnValue({ variables })
        const props = createDefaultProps({ lastRunInputData: {} })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        const input = screen.getByTestId('input-chunk_size') as HTMLInputElement
        expect(input.value).toBe('100')
      })
    })

    describe('isRunning', () => {
      it('should enable Actions button when isRunning is false', () => {
        // Arrange
        const props = createDefaultProps({ isRunning: false })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        const processButton = screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' })
        expect(processButton).not.toBeDisabled()
      })

      it('should disable Actions button when isRunning is true', () => {
        // Arrange
        const props = createDefaultProps({ isRunning: true })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        const processButton = screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' })
        expect(processButton).toBeDisabled()
      })

      it('should disable preview button when isRunning is true', () => {
        // Arrange
        const props = createDefaultProps({ isRunning: true })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('preview-btn')).toBeDisabled()
      })
    })

    describe('ref', () => {
      it('should expose submit method via ref', () => {
        // Arrange
        const ref = { current: null } as React.RefObject<{ submit: () => void } | null>
        const onSubmit = vi.fn()
        const props = createDefaultProps({ ref, onSubmit })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        expect(ref.current).not.toBeNull()
        expect(typeof ref.current?.submit).toBe('function')

        // Act - call submit via ref
        ref.current?.submit()

        // Assert - onSubmit should be called
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // ==================== User Interactions ====================
  // Test event handlers and user interactions
  describe('User Interactions', () => {
    describe('onProcess', () => {
      it('should call onProcess when Save and Process button is clicked', () => {
        // Arrange
        const onProcess = vi.fn()
        const props = createDefaultProps({ onProcess })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)
        fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

        // Assert
        expect(onProcess).toHaveBeenCalledTimes(1)
      })

      it('should not call onProcess when button is disabled due to isRunning', () => {
        // Arrange
        const onProcess = vi.fn()
        const props = createDefaultProps({ onProcess, isRunning: true })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)
        fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

        // Assert
        expect(onProcess).not.toHaveBeenCalled()
      })
    })

    describe('onPreview', () => {
      it('should call onPreview when preview button is clicked', () => {
        // Arrange
        const onPreview = vi.fn()
        const props = createDefaultProps({ onPreview })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)
        fireEvent.click(screen.getByTestId('preview-btn'))

        // Assert
        expect(onPreview).toHaveBeenCalledTimes(1)
      })
    })

    describe('onSubmit', () => {
      it('should call onSubmit with form data when form is submitted', () => {
        // Arrange
        const variables: RAGPipelineVariable[] = [
          createMockVariable({ variable: 'chunk_size', label: 'Chunk Size', type: PipelineInputVarType.number, default_value: '100' }),
        ]
        mockParamsConfig.mockReturnValue({ variables })
        const onSubmit = vi.fn()
        const props = createDefaultProps({ onSubmit })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)
        fireEvent.submit(screen.getByTestId('process-form'))

        // Assert - should submit with initial data transformed by real hooks
        // Note: default_value is string type, so the value remains as string
        expect(onSubmit).toHaveBeenCalledWith({ chunk_size: '100' })
      })
    })
  })

  // ==================== Data Transformation Tests ====================
  // Test real hooks transform data correctly
  describe('Data Transformation', () => {
    it('should transform text-input variable to string initial value', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'name', label: 'Name', type: PipelineInputVarType.textInput, default_value: 'default' }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert
      const input = screen.getByTestId('input-name') as HTMLInputElement
      expect(input.defaultValue).toBe('default')
    })

    it('should transform number variable to number initial value', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'count', label: 'Count', type: PipelineInputVarType.number, default_value: '42' }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert
      const input = screen.getByTestId('input-count') as HTMLInputElement
      expect(input.defaultValue).toBe('42')
    })

    it('should use empty string for text-input without default value', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'name', label: 'Name', type: PipelineInputVarType.textInput }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert
      const input = screen.getByTestId('input-name') as HTMLInputElement
      expect(input.defaultValue).toBe('')
    })

    it('should prioritize lastRunInputData over default_value', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'size', label: 'Size', type: PipelineInputVarType.number, default_value: '100' }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const props = createDefaultProps({ lastRunInputData: { size: 999 } })

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert
      const input = screen.getByTestId('input-size') as HTMLInputElement
      expect(input.defaultValue).toBe('999')
    })
  })

  // ==================== Edge Cases ====================
  // Test boundary conditions and error handling
  describe('Edge Cases', () => {
    describe('Empty/Null data handling', () => {
      it('should handle undefined paramsConfig.variables', () => {
        // Arrange
        mockParamsConfig.mockReturnValue({ variables: undefined })
        const props = createDefaultProps()

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert - should render without fields
        expect(screen.getByTestId('process-form')).toBeInTheDocument()
        expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
      })

      it('should handle null paramsConfig', () => {
        // Arrange
        mockParamsConfig.mockReturnValue(null)
        const props = createDefaultProps()

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('process-form')).toBeInTheDocument()
      })

      it('should handle empty variables array', () => {
        // Arrange
        mockParamsConfig.mockReturnValue({ variables: [] })
        const props = createDefaultProps()

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('process-form')).toBeInTheDocument()
        expect(screen.queryByTestId(/^field-/)).not.toBeInTheDocument()
      })
    })

    describe('Multiple variables', () => {
      it('should handle multiple variables of different types', () => {
        // Arrange
        const variables: RAGPipelineVariable[] = [
          createMockVariable({ variable: 'text_field', label: 'Text', type: PipelineInputVarType.textInput, default_value: 'hello' }),
          createMockVariable({ variable: 'number_field', label: 'Number', type: PipelineInputVarType.number, default_value: '123' }),
          createMockVariable({ variable: 'select_field', label: 'Select', type: PipelineInputVarType.select, default_value: 'option1' }),
        ]
        mockParamsConfig.mockReturnValue({ variables })
        const props = createDefaultProps()

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert - all fields should be rendered
        expect(screen.getByTestId('field-text_field')).toBeInTheDocument()
        expect(screen.getByTestId('field-number_field')).toBeInTheDocument()
        expect(screen.getByTestId('field-select_field')).toBeInTheDocument()
      })

      it('should submit all variables data correctly', () => {
        // Arrange
        const variables: RAGPipelineVariable[] = [
          createMockVariable({ variable: 'field1', label: 'Field 1', type: PipelineInputVarType.textInput, default_value: 'value1' }),
          createMockVariable({ variable: 'field2', label: 'Field 2', type: PipelineInputVarType.number, default_value: '42' }),
        ]
        mockParamsConfig.mockReturnValue({ variables })
        const onSubmit = vi.fn()
        const props = createDefaultProps({ onSubmit })

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)
        fireEvent.submit(screen.getByTestId('process-form'))

        // Assert - default_value is string type, so values remain as strings
        expect(onSubmit).toHaveBeenCalledWith({
          field1: 'value1',
          field2: '42',
        })
      })
    })

    describe('Variable with options (select type)', () => {
      it('should handle select variable with options', () => {
        // Arrange
        const variables: RAGPipelineVariable[] = [
          createMockVariable({
            variable: 'mode',
            label: 'Mode',
            type: PipelineInputVarType.select,
            options: ['auto', 'manual', 'custom'],
            default_value: 'auto',
          }),
        ]
        mockParamsConfig.mockReturnValue({ variables })
        const props = createDefaultProps()

        // Act
        renderWithProviders(<ProcessDocuments {...props} />)

        // Assert
        expect(screen.getByTestId('field-mode')).toBeInTheDocument()
        const input = screen.getByTestId('input-mode') as HTMLInputElement
        expect(input.defaultValue).toBe('auto')
      })
    })
  })

  // ==================== Integration Tests ====================
  // Test Form and Actions components work together with real hooks
  describe('Integration', () => {
    it('should coordinate form submission flow correctly', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'setting', label: 'Setting', type: PipelineInputVarType.textInput, default_value: 'initial' }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const onProcess = vi.fn()
      const onSubmit = vi.fn()
      const props = createDefaultProps({ onProcess, onSubmit })

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert - form is rendered with correct initial data
      const input = screen.getByTestId('input-setting') as HTMLInputElement
      expect(input.defaultValue).toBe('initial')

      // Act - click process button
      fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' }))

      // Assert - onProcess is called
      expect(onProcess).toHaveBeenCalled()
    })

    it('should render complete UI with all interactive elements', () => {
      // Arrange
      const variables: RAGPipelineVariable[] = [
        createMockVariable({ variable: 'test', label: 'Test Field', type: PipelineInputVarType.textInput }),
      ]
      mockParamsConfig.mockReturnValue({ variables })
      const props = createDefaultProps()

      // Act
      renderWithProviders(<ProcessDocuments {...props} />)

      // Assert - all UI elements are present
      expect(screen.getByTestId('process-form')).toBeInTheDocument()
      expect(screen.getByText('Test Field')).toBeInTheDocument()
      expect(screen.getByTestId('preview-btn')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'datasetPipeline.operations.saveAndProcess' })).toBeInTheDocument()
    })
  })
})
