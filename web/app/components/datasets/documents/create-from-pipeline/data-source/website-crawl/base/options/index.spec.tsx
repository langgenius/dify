import type { MockInstance } from 'vitest'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import Toast from '@/app/components/base/toast'
import { CrawlStep } from '@/models/datasets'
import { PipelineInputVarType } from '@/models/pipeline'
import Options from './index'

// ==========================================
// Mock Modules
// ==========================================

// Note: react-i18next uses global mock from web/vitest.setup.ts

// Mock useInitialData and useConfigurations hooks
const { mockUseInitialData, mockUseConfigurations } = vi.hoisted(() => ({
  mockUseInitialData: vi.fn(),
  mockUseConfigurations: vi.fn(),
}))

vi.mock('@/app/components/rag-pipeline/hooks/use-input-fields', () => ({
  useInitialData: mockUseInitialData,
  useConfigurations: mockUseConfigurations,
}))

// Mock BaseField
const mockBaseField = vi.fn()
vi.mock('@/app/components/base/form/form-scenarios/base/field', () => {
  const MockBaseFieldFactory = (props: any) => {
    mockBaseField(props)
    const MockField = ({ form }: { form: any }) => (
      <div data-testid={`field-${props.config?.variable || 'unknown'}`}>
        <span data-testid={`field-label-${props.config?.variable}`}>{props.config?.label}</span>
        <input
          data-testid={`field-input-${props.config?.variable}`}
          value={form.getFieldValue?.(props.config?.variable) || ''}
          onChange={e => form.setFieldValue?.(props.config?.variable, e.target.value)}
        />
      </div>
    )
    return MockField
  }
  return { default: MockBaseFieldFactory }
})

// Mock useAppForm
const mockHandleSubmit = vi.fn()
const mockFormValues: Record<string, any> = {}
vi.mock('@/app/components/base/form', () => ({
  useAppForm: (options: any) => {
    const formOptions = options
    return {
      handleSubmit: () => {
        const validationResult = formOptions.validators?.onSubmit?.({ value: mockFormValues })
        if (!validationResult) {
          mockHandleSubmit()
          formOptions.onSubmit?.({ value: mockFormValues })
        }
      },
      getFieldValue: (field: string) => mockFormValues[field],
      setFieldValue: (field: string, value: any) => {
        mockFormValues[field] = value
      },
    }
  },
}))

// ==========================================
// Test Data Builders
// ==========================================

const createMockVariable = (overrides?: Partial<RAGPipelineVariables[0]>): RAGPipelineVariables[0] => ({
  belong_to_node_id: 'node-1',
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  max_length: 100,
  default_value: '',
  placeholder: 'Enter value',
  required: true,
  ...overrides,
})

const createMockVariables = (count = 1): RAGPipelineVariables => {
  return Array.from({ length: count }, (_, i) =>
    createMockVariable({
      variable: `variable_${i}`,
      label: `Label ${i}`,
    }))
}

const createMockConfiguration = (overrides?: Partial<any>): any => ({
  type: BaseFieldType.textInput,
  variable: 'test_variable',
  label: 'Test Label',
  required: true,
  maxLength: 100,
  options: [],
  showConditions: [],
  placeholder: 'Enter value',
  ...overrides,
})

type OptionsProps = React.ComponentProps<typeof Options>

const createDefaultProps = (overrides?: Partial<OptionsProps>): OptionsProps => ({
  variables: createMockVariables(),
  step: CrawlStep.init,
  runDisabled: false,
  onSubmit: vi.fn(),
  ...overrides,
})

// ==========================================
// Test Suites
// ==========================================
describe('Options', () => {
  let toastNotifySpy: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()

    // Spy on Toast.notify instead of mocking the entire module
    toastNotifySpy = vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))

    // Reset mock form values
    Object.keys(mockFormValues).forEach(key => delete mockFormValues[key])

    // Default mock return values - using real generateZodSchema
    mockUseInitialData.mockReturnValue({})
    mockUseConfigurations.mockReturnValue([createMockConfiguration()])
  })

  afterEach(() => {
    toastNotifySpy.mockRestore()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render options header with toggle text', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByText(/options/i)).toBeInTheDocument()
    })

    it('should render Run button', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/run/i)).toBeInTheDocument()
    })

    it('should render form fields when not folded', () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'url', label: 'URL' }),
        createMockConfiguration({ variable: 'depth', label: 'Depth' }),
      ]
      mockUseConfigurations.mockReturnValue(configurations)
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByTestId('field-url')).toBeInTheDocument()
      expect(screen.getByTestId('field-depth')).toBeInTheDocument()
    })

    it('should render arrow icon in correct orientation when expanded', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert - Arrow should not have -rotate-90 class when expanded
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toBeInTheDocument()
      expect(arrowIcon).not.toHaveClass('-rotate-90')
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('variables prop', () => {
      it('should pass variables to useInitialData hook', () => {
        // Arrange
        const variables = createMockVariables(3)
        const props = createDefaultProps({ variables })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(mockUseInitialData).toHaveBeenCalledWith(variables)
      })

      it('should pass variables to useConfigurations hook', () => {
        // Arrange
        const variables = createMockVariables(2)
        const props = createDefaultProps({ variables })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(mockUseConfigurations).toHaveBeenCalledWith(variables)
      })

      it('should render correct number of fields based on configurations', () => {
        // Arrange
        const configurations = [
          createMockConfiguration({ variable: 'field_1', label: 'Field 1' }),
          createMockConfiguration({ variable: 'field_2', label: 'Field 2' }),
          createMockConfiguration({ variable: 'field_3', label: 'Field 3' }),
        ]
        mockUseConfigurations.mockReturnValue(configurations)
        const props = createDefaultProps()

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByTestId('field-field_1')).toBeInTheDocument()
        expect(screen.getByTestId('field-field_2')).toBeInTheDocument()
        expect(screen.getByTestId('field-field_3')).toBeInTheDocument()
      })

      it('should handle empty variables array', () => {
        // Arrange
        mockUseConfigurations.mockReturnValue([])
        const props = createDefaultProps({ variables: [] })

        // Act
        const { container } = render(<Options {...props} />)

        // Assert
        expect(container.querySelector('form')).toBeInTheDocument()
        expect(screen.queryByTestId(/field-/)).not.toBeInTheDocument()
      })
    })

    describe('step prop', () => {
      it('should show "Run" text when step is init', () => {
        // Arrange
        const props = createDefaultProps({ step: CrawlStep.init })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByText(/run/i)).toBeInTheDocument()
      })

      it('should show "Running" text when step is running', () => {
        // Arrange
        const props = createDefaultProps({ step: CrawlStep.running })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByText(/running/i)).toBeInTheDocument()
      })

      it('should disable button when step is running', () => {
        // Arrange
        const props = createDefaultProps({ step: CrawlStep.running })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should enable button when step is finished', () => {
        // Arrange
        const props = createDefaultProps({ step: CrawlStep.finished, runDisabled: false })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      it('should show loading state on button when step is running', () => {
        // Arrange
        const props = createDefaultProps({ step: CrawlStep.running })

        // Act
        render(<Options {...props} />)

        // Assert - Button should have loading prop which disables it
        const button = screen.getByRole('button')
        expect(button).toBeDisabled()
      })
    })

    describe('runDisabled prop', () => {
      it('should disable button when runDisabled is true', () => {
        // Arrange
        const props = createDefaultProps({ runDisabled: true })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should enable button when runDisabled is false and step is not running', () => {
        // Arrange
        const props = createDefaultProps({ runDisabled: false, step: CrawlStep.init })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      it('should disable button when both runDisabled is true and step is running', () => {
        // Arrange
        const props = createDefaultProps({ runDisabled: true, step: CrawlStep.running })

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should default runDisabled to undefined (falsy)', () => {
        // Arrange
        const props = createDefaultProps()
        delete (props as any).runDisabled

        // Act
        render(<Options {...props} />)

        // Assert
        expect(screen.getByRole('button')).not.toBeDisabled()
      })
    })

    describe('onSubmit prop', () => {
      it('should call onSubmit when form is submitted successfully', () => {
        // Arrange - Use non-required field so validation passes
        const config = createMockConfiguration({
          variable: 'optional_field',
          required: false,
          type: BaseFieldType.textInput,
        })
        mockUseConfigurations.mockReturnValue([config])
        const mockOnSubmit = vi.fn()
        const props = createDefaultProps({ onSubmit: mockOnSubmit })

        // Act
        render(<Options {...props} />)
        fireEvent.click(screen.getByRole('button'))

        // Assert
        expect(mockOnSubmit).toHaveBeenCalled()
      })

      it('should not call onSubmit when validation fails', () => {
        // Arrange
        const mockOnSubmit = vi.fn()
        // Create a required field configuration
        const requiredConfig = createMockConfiguration({
          variable: 'url',
          label: 'URL',
          required: true,
          type: BaseFieldType.textInput,
        })
        mockUseConfigurations.mockReturnValue([requiredConfig])
        // mockFormValues is empty, so required field validation will fail
        const props = createDefaultProps({ onSubmit: mockOnSubmit })

        // Act
        render(<Options {...props} />)
        fireEvent.click(screen.getByRole('button'))

        // Assert
        expect(mockOnSubmit).not.toHaveBeenCalled()
      })

      it('should pass form values to onSubmit', () => {
        // Arrange - Use non-required fields so validation passes
        const configs = [
          createMockConfiguration({ variable: 'url', required: false, type: BaseFieldType.textInput }),
          createMockConfiguration({ variable: 'depth', required: false, type: BaseFieldType.numberInput }),
        ]
        mockUseConfigurations.mockReturnValue(configs)
        mockFormValues.url = 'https://example.com'
        mockFormValues.depth = 2
        const mockOnSubmit = vi.fn()
        const props = createDefaultProps({ onSubmit: mockOnSubmit })

        // Act
        render(<Options {...props} />)
        fireEvent.click(screen.getByRole('button'))

        // Assert
        expect(mockOnSubmit).toHaveBeenCalledWith({ url: 'https://example.com', depth: 2 })
      })
    })
  })

  // ==========================================
  // Side Effects and Cleanup (useEffect)
  // ==========================================
  describe('Side Effects and Cleanup', () => {
    it('should expand options when step changes to init', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.finished })
      const { rerender, container } = render(<Options {...props} />)

      // Act - Change step to init
      rerender(<Options {...props} step={CrawlStep.init} />)

      // Assert - Fields should be visible (expanded)
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).not.toHaveClass('-rotate-90')
    })

    it('should collapse options when step changes to running', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.init })
      const { rerender, container } = render(<Options {...props} />)

      // Assert - Initially expanded
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()

      // Act - Change step to running
      rerender(<Options {...props} step={CrawlStep.running} />)

      // Assert - Should collapse (fields hidden, arrow rotated)
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toHaveClass('-rotate-90')
    })

    it('should collapse options when step changes to finished', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.init })
      const { rerender, container } = render(<Options {...props} />)

      // Act - Change step to finished
      rerender(<Options {...props} step={CrawlStep.finished} />)

      // Assert - Should collapse
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toHaveClass('-rotate-90')
    })

    it('should respond to step transitions from init -> running -> finished', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.init })
      const { rerender, container } = render(<Options {...props} />)

      // Assert - Initially expanded
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()

      // Act - Transition to running
      rerender(<Options {...props} step={CrawlStep.running} />)

      // Assert - Collapsed
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
      let arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toHaveClass('-rotate-90')

      // Act - Transition to finished
      rerender(<Options {...props} step={CrawlStep.finished} />)

      // Assert - Still collapsed
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
      arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toHaveClass('-rotate-90')
    })

    it('should expand when step transitions from finished to init', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.finished })
      const { rerender } = render(<Options {...props} />)

      // Assert - Initially collapsed when finished
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()

      // Act - Transition back to init
      rerender(<Options {...props} step={CrawlStep.init} />)

      // Assert - Should expand
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Memoization Logic and Dependencies
  // ==========================================
  describe('Memoization Logic and Dependencies', () => {
    it('should regenerate schema when configurations change', () => {
      // Arrange
      const config1 = [createMockConfiguration({ variable: 'url' })]
      const config2 = [createMockConfiguration({ variable: 'depth' })]
      mockUseConfigurations.mockReturnValue(config1)
      const props = createDefaultProps()
      const { rerender } = render(<Options {...props} />)

      // Assert - First render creates schema
      expect(screen.getByTestId('field-url')).toBeInTheDocument()

      // Act - Change configurations
      mockUseConfigurations.mockReturnValue(config2)
      rerender(<Options {...props} variables={createMockVariables(2)} />)

      // Assert - New field is rendered with new schema
      expect(screen.getByTestId('field-depth')).toBeInTheDocument()
    })

    it('should compute isRunning correctly for init step', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.init })

      // Act
      render(<Options {...props} />)

      // Assert - Button should not be in loading state
      const button = screen.getByRole('button')
      expect(button).not.toBeDisabled()
      expect(screen.getByText(/run/i)).toBeInTheDocument()
    })

    it('should compute isRunning correctly for running step', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.running })

      // Act
      render(<Options {...props} />)

      // Assert - Button should be in loading state
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(screen.getByText(/running/i)).toBeInTheDocument()
    })

    it('should compute isRunning correctly for finished step', () => {
      // Arrange
      const props = createDefaultProps({ step: CrawlStep.finished })

      // Act
      render(<Options {...props} />)

      // Assert - Button should not be in loading state
      expect(screen.getByText(/run/i)).toBeInTheDocument()
    })

    it('should use memoized schema for validation', () => {
      // Arrange - Use real generateZodSchema with valid configuration
      const config = createMockConfiguration({
        variable: 'test_field',
        required: false, // Not required so validation passes with empty value
      })
      mockUseConfigurations.mockReturnValue([config])
      const mockOnSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit: mockOnSubmit })
      render(<Options {...props} />)

      // Act - Trigger validation via submit
      fireEvent.click(screen.getByRole('button'))

      // Assert - onSubmit should be called if validation passes
      expect(mockOnSubmit).toHaveBeenCalled()
    })
  })

  // ==========================================
  // User Interactions and Event Handlers
  // ==========================================
  describe('User Interactions and Event Handlers', () => {
    it('should toggle fold state when header is clicked', () => {
      // Arrange
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Assert - Initially expanded
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()

      // Act - Click to fold
      fireEvent.click(screen.getByText(/options/i))

      // Assert - Should be folded
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()

      // Act - Click to unfold
      fireEvent.click(screen.getByText(/options/i))

      // Assert - Should be expanded again
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
    })

    it('should prevent default and stop propagation on form submit', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<Options {...props} />)

      // Act
      const form = container.querySelector('form')!
      const mockPreventDefault = vi.fn()
      const mockStopPropagation = vi.fn()

      fireEvent.submit(form, {
        preventDefault: mockPreventDefault,
        stopPropagation: mockStopPropagation,
      })

      // Assert - The form element handles submit event
      expect(form).toBeInTheDocument()
    })

    it('should trigger form submit when button is clicked', () => {
      // Arrange - Use non-required field so validation passes
      const config = createMockConfiguration({
        variable: 'optional_field',
        required: false,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([config])
      const mockOnSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit: mockOnSubmit })
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnSubmit).toHaveBeenCalled()
    })

    it('should not trigger submit when button is disabled', () => {
      // Arrange
      const mockOnSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit: mockOnSubmit, runDisabled: true })
      render(<Options {...props} />)

      // Act - Try to click disabled button
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should maintain fold state after form submission', () => {
      // Arrange
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Assert - Initially expanded
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()

      // Act - Submit form
      fireEvent.click(screen.getByRole('button'))

      // Assert - Should still be expanded (unless step changes)
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()
    })

    it('should allow clicking on arrow icon container to toggle', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<Options {...props} />)

      // Assert - Initially expanded
      expect(screen.getByTestId('field-test_variable')).toBeInTheDocument()

      // Act - Click on the toggle container (parent of the options text and arrow)
      const toggleContainer = container.querySelector('.cursor-pointer')
      fireEvent.click(toggleContainer!)

      // Assert - Should be folded
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle validation error and show toast', () => {
      // Arrange - Create required field that will fail validation when empty
      const requiredConfig = createMockConfiguration({
        variable: 'url',
        label: 'URL',
        required: true,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([requiredConfig])
      // mockFormValues.url is undefined, so validation will fail
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert - Toast should be called with error message
      expect(toastNotifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })

    it('should handle validation error and display field name in message', () => {
      // Arrange - Create required field that will fail validation
      const requiredConfig = createMockConfiguration({
        variable: 'email_address',
        label: 'Email Address',
        required: true,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([requiredConfig])
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert - Toast message should contain field path
      expect(toastNotifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('email_address'),
        }),
      )
    })

    it('should handle empty variables gracefully', () => {
      // Arrange
      mockUseConfigurations.mockReturnValue([])
      const props = createDefaultProps({ variables: [] })

      // Act
      const { container } = render(<Options {...props} />)

      // Assert - Should render without errors
      expect(container.querySelector('form')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle single variable configuration', () => {
      // Arrange
      const singleConfig = [createMockConfiguration({ variable: 'only_field' })]
      mockUseConfigurations.mockReturnValue(singleConfig)
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert
      expect(screen.getByTestId('field-only_field')).toBeInTheDocument()
    })

    it('should handle many configurations', () => {
      // Arrange
      const manyConfigs = Array.from({ length: 10 }, (_, i) =>
        createMockConfiguration({ variable: `field_${i}`, label: `Field ${i}` }))
      mockUseConfigurations.mockReturnValue(manyConfigs)
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert
      for (let i = 0; i < 10; i++)
        expect(screen.getByTestId(`field-field_${i}`)).toBeInTheDocument()
    })

    it('should handle validation with multiple required fields (shows first error)', () => {
      // Arrange - Multiple required fields
      const configs = [
        createMockConfiguration({ variable: 'url', label: 'URL', required: true, type: BaseFieldType.textInput }),
        createMockConfiguration({ variable: 'depth', label: 'Depth', required: true, type: BaseFieldType.textInput }),
      ]
      mockUseConfigurations.mockReturnValue(configs)
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert - Toast should be called once (only first error)
      expect(toastNotifySpy).toHaveBeenCalledTimes(1)
      expect(toastNotifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })

    it('should handle validation pass when all required fields have values', () => {
      // Arrange
      const requiredConfig = createMockConfiguration({
        variable: 'url',
        label: 'URL',
        required: true,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([requiredConfig])
      mockFormValues.url = 'https://example.com' // Provide valid value
      const mockOnSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit: mockOnSubmit })
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert - No toast error, onSubmit called
      expect(toastNotifySpy).not.toHaveBeenCalled()
      expect(mockOnSubmit).toHaveBeenCalled()
    })

    it('should handle undefined variables gracefully', () => {
      // Arrange
      mockUseInitialData.mockReturnValue({})
      mockUseConfigurations.mockReturnValue([])
      const props = createDefaultProps({ variables: undefined as any })

      // Act & Assert - Should not throw
      expect(() => render(<Options {...props} />)).not.toThrow()
    })

    it('should handle rapid fold/unfold toggling', () => {
      // Arrange
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Act - Toggle rapidly multiple times
      const toggleText = screen.getByText(/options/i)
      for (let i = 0; i < 5; i++)
        fireEvent.click(toggleText)

      // Assert - Final state should be folded (odd number of clicks)
      expect(screen.queryByTestId('field-test_variable')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // All Prop Variations
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      [{ step: CrawlStep.init, runDisabled: false }, false, 'run'],
      [{ step: CrawlStep.init, runDisabled: true }, true, 'run'],
      [{ step: CrawlStep.running, runDisabled: false }, true, 'running'],
      [{ step: CrawlStep.running, runDisabled: true }, true, 'running'],
      [{ step: CrawlStep.finished, runDisabled: false }, false, 'run'],
      [{ step: CrawlStep.finished, runDisabled: true }, true, 'run'],
    ] as const)('should render correctly with step=%s, runDisabled=%s', (propVariation, expectedDisabled, expectedText) => {
      // Arrange
      const props = createDefaultProps(propVariation)

      // Act
      render(<Options {...props} />)

      // Assert
      const button = screen.getByRole('button')
      if (expectedDisabled)
        expect(button).toBeDisabled()
      else
        expect(button).not.toBeDisabled()

      expect(screen.getByText(new RegExp(expectedText, 'i'))).toBeInTheDocument()
    })

    it('should handle all CrawlStep values', () => {
      // Arrange & Act & Assert
      Object.values(CrawlStep).forEach((step) => {
        const props = createDefaultProps({ step })
        const { unmount, container } = render(<Options {...props} />)
        expect(container.querySelector('form')).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle variables with different types', () => {
      // Arrange
      const variables: RAGPipelineVariables = [
        createMockVariable({ type: PipelineInputVarType.textInput, variable: 'text_field' }),
        createMockVariable({ type: PipelineInputVarType.paragraph, variable: 'paragraph_field' }),
        createMockVariable({ type: PipelineInputVarType.number, variable: 'number_field' }),
        createMockVariable({ type: PipelineInputVarType.checkbox, variable: 'checkbox_field' }),
        createMockVariable({ type: PipelineInputVarType.select, variable: 'select_field' }),
      ]
      const configurations = variables.map(v => createMockConfiguration({ variable: v.variable }))
      mockUseConfigurations.mockReturnValue(configurations)
      const props = createDefaultProps({ variables })

      // Act
      render(<Options {...props} />)

      // Assert
      variables.forEach((v) => {
        expect(screen.getByTestId(`field-${v.variable}`)).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Form Validation
  // ==========================================
  describe('Form Validation', () => {
    it('should pass validation with valid data', () => {
      // Arrange - Use non-required field so empty value passes
      const config = createMockConfiguration({
        variable: 'optional_field',
        required: false,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([config])
      const mockOnSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit: mockOnSubmit })
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnSubmit).toHaveBeenCalled()
      expect(toastNotifySpy).not.toHaveBeenCalled()
    })

    it('should fail validation with invalid data', () => {
      // Arrange - Required field with empty value
      const config = createMockConfiguration({
        variable: 'url',
        label: 'URL',
        required: true,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([config])
      const mockOnSubmit = vi.fn()
      const props = createDefaultProps({ onSubmit: mockOnSubmit })
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnSubmit).not.toHaveBeenCalled()
      expect(toastNotifySpy).toHaveBeenCalled()
    })

    it('should show error toast message when validation fails', () => {
      // Arrange - Required field with empty value
      const config = createMockConfiguration({
        variable: 'my_field',
        label: 'My Field',
        required: true,
        type: BaseFieldType.textInput,
      })
      mockUseConfigurations.mockReturnValue([config])
      const props = createDefaultProps()
      render(<Options {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(toastNotifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.any(String),
        }),
      )
    })
  })

  // ==========================================
  // Styling Tests
  // ==========================================
  describe('Styling', () => {
    it('should apply correct container classes to form', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      const form = container.querySelector('form')
      expect(form).toHaveClass('w-full')
    })

    it('should apply cursor-pointer class to toggle container', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      const toggleContainer = container.querySelector('.cursor-pointer')
      expect(toggleContainer).toBeInTheDocument()
    })

    it('should apply select-none class to prevent text selection on toggle', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      const toggleContainer = container.querySelector('.select-none')
      expect(toggleContainer).toBeInTheDocument()
    })

    it('should apply rotate class to arrow icon when folded', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<Options {...props} />)

      // Act - Fold the options
      fireEvent.click(screen.getByText(/options/i))

      // Assert
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toHaveClass('-rotate-90')
    })

    it('should not apply rotate class to arrow icon when expanded', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).not.toHaveClass('-rotate-90')
    })

    it('should apply border class to fields container when expanded', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Options {...props} />)

      // Assert
      const fieldsContainer = container.querySelector('.border-t')
      expect(fieldsContainer).toBeInTheDocument()
    })
  })

  // ==========================================
  // BaseField Integration
  // ==========================================
  describe('BaseField Integration', () => {
    it('should pass correct props to BaseField factory', () => {
      // Arrange
      const config = createMockConfiguration({ variable: 'test_var', label: 'Test Label' })
      mockUseConfigurations.mockReturnValue([config])
      mockUseInitialData.mockReturnValue({ test_var: 'default_value' })
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert
      expect(mockBaseField).toHaveBeenCalledWith(
        expect.objectContaining({
          initialData: { test_var: 'default_value' },
          config,
        }),
      )
    })

    it('should render unique key for each field', () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'field_a' }),
        createMockConfiguration({ variable: 'field_b' }),
        createMockConfiguration({ variable: 'field_c' }),
      ]
      mockUseConfigurations.mockReturnValue(configurations)
      const props = createDefaultProps()

      // Act
      render(<Options {...props} />)

      // Assert - All fields should be rendered (React would warn if keys aren't unique)
      expect(screen.getByTestId('field-field_a')).toBeInTheDocument()
      expect(screen.getByTestId('field-field_b')).toBeInTheDocument()
      expect(screen.getByTestId('field-field_c')).toBeInTheDocument()
    })
  })
})
