import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { z } from 'zod'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import Toast from '@/app/components/base/toast'
import Actions from './actions'
import Form from './form'
import Header from './header'

// ==========================================
// Spy on Toast.notify for validation tests
// ==========================================
const toastNotifySpy = vi.spyOn(Toast, 'notify')

// ==========================================
// Test Data Factory Functions
// ==========================================

/**
 * Creates mock configuration for testing
 */
const createMockConfiguration = (overrides: Partial<BaseConfiguration> = {}): BaseConfiguration => ({
  type: BaseFieldType.textInput,
  variable: 'testVariable',
  label: 'Test Label',
  required: false,
  maxLength: undefined,
  options: undefined,
  showConditions: [],
  placeholder: 'Enter value',
  tooltip: '',
  ...overrides,
})

/**
 * Creates a valid Zod schema for testing
 */
const createMockSchema = () => {
  return z.object({
    field1: z.string().optional(),
  })
}

/**
 * Creates a schema that always fails validation
 */
const createFailingSchema = () => {
  return {
    safeParse: () => ({
      success: false,
      error: {
        issues: [{ path: ['field1'], message: 'is required' }],
      },
    }),
  } as unknown as z.ZodSchema
}

// ==========================================
// Actions Component Tests
// ==========================================
describe('Actions', () => {
  const defaultActionsProps = {
    onBack: vi.fn(),
    onProcess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<Actions {...defaultActionsProps} />)

      // Assert
      expect(screen.getByText('datasetPipeline.operations.dataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.saveAndProcess')).toBeInTheDocument()
    })

    it('should render back button with arrow icon', () => {
      // Arrange & Act
      render(<Actions {...defaultActionsProps} />)

      // Assert
      const backButton = screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i })
      expect(backButton).toBeInTheDocument()
      expect(backButton.querySelector('svg')).toBeInTheDocument()
    })

    it('should render process button', () => {
      // Arrange & Act
      render(<Actions {...defaultActionsProps} />)

      // Assert
      const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
      expect(processButton).toBeInTheDocument()
    })

    it('should have correct container layout', () => {
      // Arrange & Act
      const { container } = render(<Actions {...defaultActionsProps} />)

      // Assert
      const mainContainer = container.querySelector('.flex.items-center.justify-between')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('runDisabled prop', () => {
      it('should not disable process button when runDisabled is false', () => {
        // Arrange & Act
        render(<Actions {...defaultActionsProps} runDisabled={false} />)

        // Assert
        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).not.toBeDisabled()
      })

      it('should disable process button when runDisabled is true', () => {
        // Arrange & Act
        render(<Actions {...defaultActionsProps} runDisabled={true} />)

        // Assert
        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).toBeDisabled()
      })

      it('should not disable process button when runDisabled is undefined', () => {
        // Arrange & Act
        render(<Actions {...defaultActionsProps} runDisabled={undefined} />)

        // Assert
        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).not.toBeDisabled()
      })
    })
  })

  // ==========================================
  // User Interactions Testing
  // ==========================================
  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      // Arrange
      const onBack = vi.fn()
      render(<Actions {...defaultActionsProps} onBack={onBack} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i }))

      // Assert
      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onProcess when process button is clicked', () => {
      // Arrange
      const onProcess = vi.fn()
      render(<Actions {...defaultActionsProps} onProcess={onProcess} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }))

      // Assert
      expect(onProcess).toHaveBeenCalledTimes(1)
    })

    it('should not call onProcess when process button is disabled and clicked', () => {
      // Arrange
      const onProcess = vi.fn()
      render(<Actions {...defaultActionsProps} onProcess={onProcess} runDisabled={true} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }))

      // Assert
      expect(onProcess).not.toHaveBeenCalled()
    })
  })

  // ==========================================
  // Component Memoization Testing
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(Actions.$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

// ==========================================
// Header Component Tests
// ==========================================
describe('Header', () => {
  const defaultHeaderProps = {
    onReset: vi.fn(),
    resetDisabled: false,
    previewDisabled: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should render reset button', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} />)

      // Assert
      expect(screen.getByRole('button', { name: /common.operation.reset/i })).toBeInTheDocument()
    })

    it('should render preview button with icon', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} />)

      // Assert
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(previewButton).toBeInTheDocument()
      expect(previewButton.querySelector('svg')).toBeInTheDocument()
    })

    it('should render title with correct text', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should have correct container layout', () => {
      // Arrange & Act
      const { container } = render(<Header {...defaultHeaderProps} />)

      // Assert
      const mainContainer = container.querySelector('.flex.items-center.gap-x-1')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('resetDisabled prop', () => {
      it('should not disable reset button when resetDisabled is false', () => {
        // Arrange & Act
        render(<Header {...defaultHeaderProps} resetDisabled={false} />)

        // Assert
        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).not.toBeDisabled()
      })

      it('should disable reset button when resetDisabled is true', () => {
        // Arrange & Act
        render(<Header {...defaultHeaderProps} resetDisabled={true} />)

        // Assert
        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).toBeDisabled()
      })
    })

    describe('previewDisabled prop', () => {
      it('should not disable preview button when previewDisabled is false', () => {
        // Arrange & Act
        render(<Header {...defaultHeaderProps} previewDisabled={false} />)

        // Assert
        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).not.toBeDisabled()
      })

      it('should disable preview button when previewDisabled is true', () => {
        // Arrange & Act
        render(<Header {...defaultHeaderProps} previewDisabled={true} />)

        // Assert
        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).toBeDisabled()
      })
    })

    it('should handle onPreview being undefined', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} onPreview={undefined} />)

      // Assert
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(previewButton).toBeInTheDocument()
      // Click should not throw
      let didThrow = false
      try {
        fireEvent.click(previewButton)
      }
      catch {
        didThrow = true
      }
      expect(didThrow).toBe(false)
    })
  })

  // ==========================================
  // User Interactions Testing
  // ==========================================
  describe('User Interactions', () => {
    it('should call onReset when reset button is clicked', () => {
      // Arrange
      const onReset = vi.fn()
      render(<Header {...defaultHeaderProps} onReset={onReset} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /common.operation.reset/i }))

      // Assert
      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('should not call onReset when reset button is disabled and clicked', () => {
      // Arrange
      const onReset = vi.fn()
      render(<Header {...defaultHeaderProps} onReset={onReset} resetDisabled={true} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /common.operation.reset/i }))

      // Assert
      expect(onReset).not.toHaveBeenCalled()
    })

    it('should call onPreview when preview button is clicked', () => {
      // Arrange
      const onPreview = vi.fn()
      render(<Header {...defaultHeaderProps} onPreview={onPreview} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      // Assert
      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should not call onPreview when preview button is disabled and clicked', () => {
      // Arrange
      const onPreview = vi.fn()
      render(<Header {...defaultHeaderProps} onPreview={onPreview} previewDisabled={true} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      // Assert
      expect(onPreview).not.toHaveBeenCalled()
    })
  })

  // ==========================================
  // Component Memoization Testing
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(Header.$$typeof).toBe(Symbol.for('react.memo'))
    })
  })

  // ==========================================
  // Edge Cases Testing
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle both buttons disabled', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} resetDisabled={true} previewDisabled={true} />)

      // Assert
      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(resetButton).toBeDisabled()
      expect(previewButton).toBeDisabled()
    })

    it('should handle both buttons enabled', () => {
      // Arrange & Act
      render(<Header {...defaultHeaderProps} resetDisabled={false} previewDisabled={false} />)

      // Assert
      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(resetButton).not.toBeDisabled()
      expect(previewButton).not.toBeDisabled()
    })
  })
})

// ==========================================
// Form Component Tests
// ==========================================
describe('Form', () => {
  const defaultFormProps = {
    initialData: { field1: '' },
    configurations: [] as BaseConfiguration[],
    schema: createMockSchema(),
    onSubmit: vi.fn(),
    onPreview: vi.fn(),
    ref: { current: null } as React.RefObject<unknown>,
    isRunning: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    toastNotifySpy.mockClear()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should render form element', () => {
      // Arrange & Act
      const { container } = render(<Form {...defaultFormProps} />)

      // Assert
      const form = container.querySelector('form')
      expect(form).toBeInTheDocument()
    })

    it('should render Header component', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common.operation.reset/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })).toBeInTheDocument()
    })

    it('should have correct form structure', () => {
      // Arrange & Act
      const { container } = render(<Form {...defaultFormProps} />)

      // Assert
      const form = container.querySelector('form.flex.w-full.flex-col')
      expect(form).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('isRunning prop', () => {
      it('should disable preview button when isRunning is true', () => {
        // Arrange & Act
        render(<Form {...defaultFormProps} isRunning={true} />)

        // Assert
        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).toBeDisabled()
      })

      it('should not disable preview button when isRunning is false', () => {
        // Arrange & Act
        render(<Form {...defaultFormProps} isRunning={false} />)

        // Assert
        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).not.toBeDisabled()
      })
    })

    describe('configurations prop', () => {
      it('should render empty when configurations is empty', () => {
        // Arrange & Act
        const { container } = render(<Form {...defaultFormProps} configurations={[]} />)

        // Assert - the fields container should have no field children
        const fieldsContainer = container.querySelector('.flex.flex-col.gap-3')
        expect(fieldsContainer?.children.length).toBe(0)
      })

      it('should render all configurations', () => {
        // Arrange
        const configurations = [
          createMockConfiguration({ variable: 'var1', label: 'Variable 1' }),
          createMockConfiguration({ variable: 'var2', label: 'Variable 2' }),
          createMockConfiguration({ variable: 'var3', label: 'Variable 3' }),
        ]

        // Act
        render(<Form {...defaultFormProps} configurations={configurations} initialData={{ var1: '', var2: '', var3: '' }} />)

        // Assert
        expect(screen.getByText('Variable 1')).toBeInTheDocument()
        expect(screen.getByText('Variable 2')).toBeInTheDocument()
        expect(screen.getByText('Variable 3')).toBeInTheDocument()
      })
    })

    it('should expose submit method via ref', () => {
      // Arrange
      const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>

      // Act
      render(<Form {...defaultFormProps} ref={mockRef} />)

      // Assert
      expect(mockRef.current).not.toBeNull()
      expect(typeof mockRef.current?.submit).toBe('function')
    })
  })

  // ==========================================
  // Ref Submit Testing
  // ==========================================
  describe('Ref Submit', () => {
    it('should call onSubmit when ref.submit() is called', async () => {
      // Arrange
      const onSubmit = vi.fn()
      const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>
      render(<Form {...defaultFormProps} ref={mockRef} onSubmit={onSubmit} />)

      // Act - call submit via ref
      mockRef.current?.submit()

      // Assert
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })

    it('should trigger form validation when ref.submit() is called', async () => {
      // Arrange
      const failingSchema = createFailingSchema()
      const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>
      render(<Form {...defaultFormProps} ref={mockRef} schema={failingSchema} />)

      // Act - call submit via ref
      mockRef.current?.submit()

      // Assert - validation error should be shown
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          type: 'error',
          message: '"field1" is required',
        })
      })
    })
  })

  // ==========================================
  // User Interactions Testing
  // ==========================================
  describe('User Interactions', () => {
    it('should call onPreview when preview button is clicked', () => {
      // Arrange
      const onPreview = vi.fn()
      render(<Form {...defaultFormProps} onPreview={onPreview} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      // Assert
      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should handle form submission via form element', async () => {
      // Arrange
      const onSubmit = vi.fn()
      const { container } = render(<Form {...defaultFormProps} onSubmit={onSubmit} />)
      const form = container.querySelector('form')!

      // Act
      fireEvent.submit(form)

      // Assert
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // ==========================================
  // Form State Testing
  // ==========================================
  describe('Form State', () => {
    it('should disable reset button initially when form is not dirty', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} />)

      // Assert
      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      expect(resetButton).toBeDisabled()
    })

    it('should enable reset button when form becomes dirty', async () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Field 1' }),
      ]

      render(<Form {...defaultFormProps} configurations={configurations} />)

      // Act - change input to make form dirty
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      // Assert
      await waitFor(() => {
        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).not.toBeDisabled()
      })
    })

    it('should reset form to initial values when reset button is clicked', async () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Field 1' }),
      ]
      const initialData = { field1: 'initial value' }

      render(<Form {...defaultFormProps} configurations={configurations} initialData={initialData} />)

      // Act - change input to make form dirty
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      // Wait for reset button to be enabled
      await waitFor(() => {
        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).not.toBeDisabled()
      })

      // Click reset button
      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      fireEvent.click(resetButton)

      // Assert - form should be reset, button should be disabled again
      await waitFor(() => {
        expect(resetButton).toBeDisabled()
      })
    })

    it('should call form.reset when handleReset is triggered', async () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Field 1' }),
      ]
      const initialData = { field1: 'original' }

      render(<Form {...defaultFormProps} configurations={configurations} initialData={initialData} />)

      // Make form dirty
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'modified' } })

      // Wait for dirty state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /common.operation.reset/i })).not.toBeDisabled()
      })

      // Act - click reset
      fireEvent.click(screen.getByRole('button', { name: /common.operation.reset/i }))

      // Assert - input should be reset to initial value
      await waitFor(() => {
        expect(input).toHaveValue('original')
      })
    })
  })

  // ==========================================
  // Validation Testing
  // ==========================================
  describe('Validation', () => {
    it('should show toast notification on validation error', async () => {
      // Arrange
      const failingSchema = createFailingSchema()
      const { container } = render(<Form {...defaultFormProps} schema={failingSchema} />)

      // Act
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          type: 'error',
          message: '"field1" is required',
        })
      })
    })

    it('should not call onSubmit when validation fails', async () => {
      // Arrange
      const onSubmit = vi.fn()
      const failingSchema = createFailingSchema()
      const { container } = render(<Form {...defaultFormProps} schema={failingSchema} onSubmit={onSubmit} />)

      // Act
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert - wait a bit and verify onSubmit was not called
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalled()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should call onSubmit when validation passes', async () => {
      // Arrange
      const onSubmit = vi.fn()
      const passingSchema = createMockSchema()
      const { container } = render(<Form {...defaultFormProps} schema={passingSchema} onSubmit={onSubmit} />)

      // Act
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // ==========================================
  // Edge Cases Testing
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle empty initialData', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} initialData={{}} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should handle configurations with different field types', () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ type: BaseFieldType.textInput, variable: 'text', label: 'Text Field' }),
        createMockConfiguration({ type: BaseFieldType.numberInput, variable: 'number', label: 'Number Field' }),
      ]

      // Act
      render(<Form {...defaultFormProps} configurations={configurations} initialData={{ text: '', number: 0 }} />)

      // Assert
      expect(screen.getByText('Text Field')).toBeInTheDocument()
      expect(screen.getByText('Number Field')).toBeInTheDocument()
    })

    it('should handle null ref', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} ref={{ current: null }} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Configuration Variations Testing
  // ==========================================
  describe('Configuration Variations', () => {
    it('should render configuration with label', () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Custom Label' }),
      ]

      // Act
      render(<Form {...defaultFormProps} configurations={configurations} />)

      // Assert
      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should render required configuration', () => {
      // Arrange
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Required Field', required: true }),
      ]

      // Act
      render(<Form {...defaultFormProps} configurations={configurations} />)

      // Assert
      expect(screen.getByText('Required Field')).toBeInTheDocument()
    })
  })
})

// ==========================================
// Integration Tests (Cross-component)
// ==========================================
describe('Process Documents Components Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Form with Header Integration', () => {
    const defaultFormProps = {
      initialData: { field1: '' },
      configurations: [] as BaseConfiguration[],
      schema: createMockSchema(),
      onSubmit: vi.fn(),
      onPreview: vi.fn(),
      ref: { current: null } as React.RefObject<unknown>,
      isRunning: false,
    }

    it('should render Header within Form', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} />)

      // Assert
      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common.operation.reset/i })).toBeInTheDocument()
    })

    it('should pass isRunning to Header for previewDisabled', () => {
      // Arrange & Act
      render(<Form {...defaultFormProps} isRunning={true} />)

      // Assert
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(previewButton).toBeDisabled()
    })
  })
})
