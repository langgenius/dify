import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import * as z from 'zod'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import Toast from '@/app/components/base/toast'
import Actions from '../actions'
import Form from '../form'
import Header from '../header'

// Spy on Toast.notify for validation tests
const toastNotifySpy = vi.spyOn(Toast, 'notify')

// Test Data Factory Functions

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
  } as unknown as z.ZodType
}

// Actions Component Tests
describe('Actions', () => {
  const defaultActionsProps = {
    onBack: vi.fn(),
    onProcess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Actions {...defaultActionsProps} />)

      expect(screen.getByText('datasetPipeline.operations.dataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.operations.saveAndProcess')).toBeInTheDocument()
    })

    it('should render back button with arrow icon', () => {
      render(<Actions {...defaultActionsProps} />)

      const backButton = screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i })
      expect(backButton).toBeInTheDocument()
      expect(backButton.querySelector('svg')).toBeInTheDocument()
    })

    it('should render process button', () => {
      render(<Actions {...defaultActionsProps} />)

      const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
      expect(processButton).toBeInTheDocument()
    })

    it('should have correct container layout', () => {
      const { container } = render(<Actions {...defaultActionsProps} />)

      const mainContainer = container.querySelector('.flex.items-center.justify-between')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('runDisabled prop', () => {
      it('should not disable process button when runDisabled is false', () => {
        render(<Actions {...defaultActionsProps} runDisabled={false} />)

        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).not.toBeDisabled()
      })

      it('should disable process button when runDisabled is true', () => {
        render(<Actions {...defaultActionsProps} runDisabled={true} />)

        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).toBeDisabled()
      })

      it('should not disable process button when runDisabled is undefined', () => {
        render(<Actions {...defaultActionsProps} runDisabled={undefined} />)

        const processButton = screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i })
        expect(processButton).not.toBeDisabled()
      })
    })
  })

  // User Interactions Testing
  describe('User Interactions', () => {
    it('should call onBack when back button is clicked', () => {
      const onBack = vi.fn()
      render(<Actions {...defaultActionsProps} onBack={onBack} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.dataSource/i }))

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('should call onProcess when process button is clicked', () => {
      const onProcess = vi.fn()
      render(<Actions {...defaultActionsProps} onProcess={onProcess} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }))

      expect(onProcess).toHaveBeenCalledTimes(1)
    })

    it('should not call onProcess when process button is disabled and clicked', () => {
      const onProcess = vi.fn()
      render(<Actions {...defaultActionsProps} onProcess={onProcess} runDisabled={true} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.operations.saveAndProcess/i }))

      expect(onProcess).not.toHaveBeenCalled()
    })
  })

  // Component Memoization Testing
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(Actions.$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

// Header Component Tests
describe('Header', () => {
  const defaultHeaderProps = {
    onReset: vi.fn(),
    resetDisabled: false,
    previewDisabled: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Header {...defaultHeaderProps} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should render reset button', () => {
      render(<Header {...defaultHeaderProps} />)

      expect(screen.getByRole('button', { name: /common.operation.reset/i })).toBeInTheDocument()
    })

    it('should render preview button with icon', () => {
      render(<Header {...defaultHeaderProps} />)

      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(previewButton).toBeInTheDocument()
      expect(previewButton.querySelector('svg')).toBeInTheDocument()
    })

    it('should render title with correct text', () => {
      render(<Header {...defaultHeaderProps} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should have correct container layout', () => {
      const { container } = render(<Header {...defaultHeaderProps} />)

      const mainContainer = container.querySelector('.flex.items-center.gap-x-1')
      expect(mainContainer).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('resetDisabled prop', () => {
      it('should not disable reset button when resetDisabled is false', () => {
        render(<Header {...defaultHeaderProps} resetDisabled={false} />)

        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).not.toBeDisabled()
      })

      it('should disable reset button when resetDisabled is true', () => {
        render(<Header {...defaultHeaderProps} resetDisabled={true} />)

        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).toBeDisabled()
      })
    })

    describe('previewDisabled prop', () => {
      it('should not disable preview button when previewDisabled is false', () => {
        render(<Header {...defaultHeaderProps} previewDisabled={false} />)

        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).not.toBeDisabled()
      })

      it('should disable preview button when previewDisabled is true', () => {
        render(<Header {...defaultHeaderProps} previewDisabled={true} />)

        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).toBeDisabled()
      })
    })

    it('should handle onPreview being undefined', () => {
      render(<Header {...defaultHeaderProps} onPreview={undefined} />)

      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(previewButton).toBeInTheDocument()
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

  // User Interactions Testing
  describe('User Interactions', () => {
    it('should call onReset when reset button is clicked', () => {
      const onReset = vi.fn()
      render(<Header {...defaultHeaderProps} onReset={onReset} />)

      fireEvent.click(screen.getByRole('button', { name: /common.operation.reset/i }))

      expect(onReset).toHaveBeenCalledTimes(1)
    })

    it('should not call onReset when reset button is disabled and clicked', () => {
      const onReset = vi.fn()
      render(<Header {...defaultHeaderProps} onReset={onReset} resetDisabled={true} />)

      fireEvent.click(screen.getByRole('button', { name: /common.operation.reset/i }))

      expect(onReset).not.toHaveBeenCalled()
    })

    it('should call onPreview when preview button is clicked', () => {
      const onPreview = vi.fn()
      render(<Header {...defaultHeaderProps} onPreview={onPreview} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should not call onPreview when preview button is disabled and clicked', () => {
      const onPreview = vi.fn()
      render(<Header {...defaultHeaderProps} onPreview={onPreview} previewDisabled={true} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      expect(onPreview).not.toHaveBeenCalled()
    })
  })

  // Component Memoization Testing
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(Header.$$typeof).toBe(Symbol.for('react.memo'))
    })
  })

  // Edge Cases Testing
  describe('Edge Cases', () => {
    it('should handle both buttons disabled', () => {
      render(<Header {...defaultHeaderProps} resetDisabled={true} previewDisabled={true} />)

      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(resetButton).toBeDisabled()
      expect(previewButton).toBeDisabled()
    })

    it('should handle both buttons enabled', () => {
      render(<Header {...defaultHeaderProps} resetDisabled={false} previewDisabled={false} />)

      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(resetButton).not.toBeDisabled()
      expect(previewButton).not.toBeDisabled()
    })
  })
})

// Form Component Tests
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

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Form {...defaultFormProps} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should render form element', () => {
      const { container } = render(<Form {...defaultFormProps} />)

      const form = container.querySelector('form')
      expect(form).toBeInTheDocument()
    })

    it('should render Header component', () => {
      render(<Form {...defaultFormProps} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common.operation.reset/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })).toBeInTheDocument()
    })

    it('should have correct form structure', () => {
      const { container } = render(<Form {...defaultFormProps} />)

      const form = container.querySelector('form.flex.w-full.flex-col')
      expect(form).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('isRunning prop', () => {
      it('should disable preview button when isRunning is true', () => {
        render(<Form {...defaultFormProps} isRunning={true} />)

        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).toBeDisabled()
      })

      it('should not disable preview button when isRunning is false', () => {
        render(<Form {...defaultFormProps} isRunning={false} />)

        const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
        expect(previewButton).not.toBeDisabled()
      })
    })

    describe('configurations prop', () => {
      it('should render empty when configurations is empty', () => {
        const { container } = render(<Form {...defaultFormProps} configurations={[]} />)

        // Assert - the fields container should have no field children
        const fieldsContainer = container.querySelector('.flex.flex-col.gap-3')
        expect(fieldsContainer?.children.length).toBe(0)
      })

      it('should render all configurations', () => {
        const configurations = [
          createMockConfiguration({ variable: 'var1', label: 'Variable 1' }),
          createMockConfiguration({ variable: 'var2', label: 'Variable 2' }),
          createMockConfiguration({ variable: 'var3', label: 'Variable 3' }),
        ]

        render(<Form {...defaultFormProps} configurations={configurations} initialData={{ var1: '', var2: '', var3: '' }} />)

        expect(screen.getByText('Variable 1')).toBeInTheDocument()
        expect(screen.getByText('Variable 2')).toBeInTheDocument()
        expect(screen.getByText('Variable 3')).toBeInTheDocument()
      })
    })

    it('should expose submit method via ref', () => {
      const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>

      render(<Form {...defaultFormProps} ref={mockRef} />)

      expect(mockRef.current).not.toBeNull()
      expect(typeof mockRef.current?.submit).toBe('function')
    })
  })

  // Ref Submit Testing
  describe('Ref Submit', () => {
    it('should call onSubmit when ref.submit() is called', async () => {
      const onSubmit = vi.fn()
      const mockRef = { current: null } as React.MutableRefObject<{ submit: () => void } | null>
      render(<Form {...defaultFormProps} ref={mockRef} onSubmit={onSubmit} />)

      // Act - call submit via ref
      mockRef.current?.submit()

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })

    it('should trigger form validation when ref.submit() is called', async () => {
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

  // User Interactions Testing
  describe('User Interactions', () => {
    it('should call onPreview when preview button is clicked', () => {
      const onPreview = vi.fn()
      render(<Form {...defaultFormProps} onPreview={onPreview} />)

      fireEvent.click(screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i }))

      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('should handle form submission via form element', async () => {
      const onSubmit = vi.fn()
      const { container } = render(<Form {...defaultFormProps} onSubmit={onSubmit} />)
      const form = container.querySelector('form')!

      fireEvent.submit(form)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // Form State Testing
  describe('Form State', () => {
    it('should disable reset button initially when form is not dirty', () => {
      render(<Form {...defaultFormProps} />)

      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      expect(resetButton).toBeDisabled()
    })

    it('should enable reset button when form becomes dirty', async () => {
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Field 1' }),
      ]

      render(<Form {...defaultFormProps} configurations={configurations} />)

      // Act - change input to make form dirty
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      await waitFor(() => {
        const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
        expect(resetButton).not.toBeDisabled()
      })
    })

    it('should reset form to initial values when reset button is clicked', async () => {
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

      const resetButton = screen.getByRole('button', { name: /common.operation.reset/i })
      fireEvent.click(resetButton)

      // Assert - form should be reset, button should be disabled again
      await waitFor(() => {
        expect(resetButton).toBeDisabled()
      })
    })

    it('should call form.reset when handleReset is triggered', async () => {
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

  // Validation Testing
  describe('Validation', () => {
    it('should show toast notification on validation error', async () => {
      const failingSchema = createFailingSchema()
      const { container } = render(<Form {...defaultFormProps} schema={failingSchema} />)

      const form = container.querySelector('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          type: 'error',
          message: '"field1" is required',
        })
      })
    })

    it('should not call onSubmit when validation fails', async () => {
      const onSubmit = vi.fn()
      const failingSchema = createFailingSchema()
      const { container } = render(<Form {...defaultFormProps} schema={failingSchema} onSubmit={onSubmit} />)

      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert - wait a bit and verify onSubmit was not called
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalled()
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should call onSubmit when validation passes', async () => {
      const onSubmit = vi.fn()
      const passingSchema = createMockSchema()
      const { container } = render(<Form {...defaultFormProps} schema={passingSchema} onSubmit={onSubmit} />)

      const form = container.querySelector('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })
  })

  // Edge Cases Testing
  describe('Edge Cases', () => {
    it('should handle empty initialData', () => {
      render(<Form {...defaultFormProps} initialData={{}} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })

    it('should handle configurations with different field types', () => {
      const configurations = [
        createMockConfiguration({ type: BaseFieldType.textInput, variable: 'text', label: 'Text Field' }),
        createMockConfiguration({ type: BaseFieldType.numberInput, variable: 'number', label: 'Number Field' }),
      ]

      render(<Form {...defaultFormProps} configurations={configurations} initialData={{ text: '', number: 0 }} />)

      expect(screen.getByText('Text Field')).toBeInTheDocument()
      expect(screen.getByText('Number Field')).toBeInTheDocument()
    })

    it('should handle null ref', () => {
      render(<Form {...defaultFormProps} ref={{ current: null }} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
    })
  })

  // Configuration Variations Testing
  describe('Configuration Variations', () => {
    it('should render configuration with label', () => {
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Custom Label' }),
      ]

      render(<Form {...defaultFormProps} configurations={configurations} />)

      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should render required configuration', () => {
      const configurations = [
        createMockConfiguration({ variable: 'field1', label: 'Required Field', required: true }),
      ]

      render(<Form {...defaultFormProps} configurations={configurations} />)

      expect(screen.getByText('Required Field')).toBeInTheDocument()
    })
  })
})

// Integration Tests (Cross-component)
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
      render(<Form {...defaultFormProps} />)

      expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common.operation.reset/i })).toBeInTheDocument()
    })

    it('should pass isRunning to Header for previewDisabled', () => {
      render(<Form {...defaultFormProps} isRunning={true} />)

      const previewButton = screen.getByRole('button', { name: /datasetPipeline.addDocuments.stepTwo.previewChunks/i })
      expect(previewButton).toBeDisabled()
    })
  })
})
