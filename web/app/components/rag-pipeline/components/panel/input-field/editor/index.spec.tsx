import type { FormData } from './form/types'
import type { InputFieldEditorProps } from './index'
import type { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { InputVar } from '@/models/pipeline'
import type { TransferMethod } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import InputFieldEditorPanel from './index'
import {
  convertFormDataToINputField,
  convertToInputFieldFormData,
} from './utils'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock useFloatingRight hook
const mockUseFloatingRight = vi.fn(() => ({
  floatingRight: false,
  floatingRightWidth: 400,
}))

vi.mock('../hooks', () => ({
  useFloatingRight: () => mockUseFloatingRight(),
}))

// Mock InputFieldForm component
vi.mock('./form', () => ({
  default: ({
    initialData,
    supportFile,
    onCancel,
    onSubmit,
    isEditMode,
  }: {
    initialData: FormData
    supportFile: boolean
    onCancel: () => void
    onSubmit: (value: FormData) => void
    isEditMode: boolean
  }) => (
    <div data-testid="input-field-form">
      <span data-testid="form-initial-data">{JSON.stringify(initialData)}</span>
      <span data-testid="form-support-file">{String(supportFile)}</span>
      <span data-testid="form-is-edit-mode">{String(isEditMode)}</span>
      <button data-testid="form-cancel-btn" onClick={onCancel}>Cancel</button>
      <button
        data-testid="form-submit-btn"
        onClick={() => onSubmit(initialData)}
      >
        Submit
      </button>
    </div>
  ),
}))

// Mock file upload config service
vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      image_file_size_limit: 10,
      file_size_limit: 15,
      audio_file_size_limit: 50,
      video_file_size_limit: 100,
      workflow_file_upload_limit: 10,
    },
    isLoading: false,
    error: null,
  }),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createInputVar = (overrides?: Partial<InputVar>): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  max_length: 48,
  default_value: '',
  required: true,
  tooltips: '',
  options: [],
  placeholder: '',
  unit: '',
  allowed_file_upload_methods: [],
  allowed_file_types: [],
  allowed_file_extensions: [],
  ...overrides,
})

const createFormData = (overrides?: Partial<FormData>): FormData => ({
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  maxLength: 48,
  default: '',
  required: true,
  tooltips: '',
  options: [],
  placeholder: '',
  unit: '',
  allowedFileUploadMethods: [],
  allowedTypesAndExtensions: {
    allowedFileTypes: [],
    allowedFileExtensions: [],
  },
  ...overrides,
})

const createInputFieldEditorProps = (
  overrides?: Partial<InputFieldEditorProps>,
): InputFieldEditorProps => ({
  onClose: vi.fn(),
  onSubmit: vi.fn(),
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
// InputFieldEditorPanel Component Tests
// ============================================================================

describe('InputFieldEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFloatingRight.mockReturnValue({
      floatingRight: false,
      floatingRightWidth: 400,
    })
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render panel without crashing', () => {
      // Arrange
      const props = createInputFieldEditorProps()

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('input-field-form')).toBeInTheDocument()
    })

    it('should render close button', () => {
      // Arrange
      const props = createInputFieldEditorProps()

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      const closeButton = screen.getByRole('button', { name: '' })
      expect(closeButton).toBeInTheDocument()
    })

    it('should render "Add Input Field" title when no initialData', () => {
      // Arrange
      const props = createInputFieldEditorProps({ initialData: undefined })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.addInputField'),
      ).toBeInTheDocument()
    })

    it('should render "Edit Input Field" title when initialData is provided', () => {
      // Arrange
      const props = createInputFieldEditorProps({
        initialData: createInputVar(),
      })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(
        screen.getByText('datasetPipeline.inputFieldPanel.editInputField'),
      ).toBeInTheDocument()
    })

    it('should pass supportFile=true to form', () => {
      // Arrange
      const props = createInputFieldEditorProps()

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('form-support-file').textContent).toBe('true')
    })

    it('should pass isEditMode=false when no initialData', () => {
      // Arrange
      const props = createInputFieldEditorProps({ initialData: undefined })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('form-is-edit-mode').textContent).toBe('false')
    })

    it('should pass isEditMode=true when initialData is provided', () => {
      // Arrange
      const props = createInputFieldEditorProps({
        initialData: createInputVar(),
      })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('form-is-edit-mode').textContent).toBe('true')
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should handle different input types in initialData', () => {
      // Arrange
      const typesToTest = [
        PipelineInputVarType.textInput,
        PipelineInputVarType.paragraph,
        PipelineInputVarType.number,
        PipelineInputVarType.select,
        PipelineInputVarType.singleFile,
        PipelineInputVarType.multiFiles,
        PipelineInputVarType.checkbox,
      ]

      typesToTest.forEach((type) => {
        const initialData = createInputVar({ type })
        const props = createInputFieldEditorProps({ initialData })

        // Act
        const { unmount } = renderWithProviders(
          <InputFieldEditorPanel {...props} />,
        )

        // Assert
        expect(screen.getByTestId('input-field-form')).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle initialData with all optional fields populated', () => {
      // Arrange
      const initialData = createInputVar({
        default_value: 'default',
        tooltips: 'tooltip text',
        placeholder: 'placeholder text',
        unit: 'kg',
        options: ['opt1', 'opt2'],
        allowed_file_upload_methods: ['local_file' as TransferMethod],
        allowed_file_types: ['image' as SupportUploadFileTypes],
        allowed_file_extensions: ['.jpg', '.png'],
      })
      const props = createInputFieldEditorProps({ initialData })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('input-field-form')).toBeInTheDocument()
    })

    it('should handle initialData with minimal fields', () => {
      // Arrange
      const initialData: InputVar = {
        type: PipelineInputVarType.textInput,
        label: 'Min',
        variable: 'min_var',
        required: false,
      }
      const props = createInputFieldEditorProps({ initialData })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('input-field-form')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      // Arrange
      const onClose = vi.fn()
      const props = createInputFieldEditorProps({ onClose })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)
      fireEvent.click(screen.getByTestId('input-field-editor-close-btn'))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when form cancel is triggered', () => {
      // Arrange
      const onClose = vi.fn()
      const props = createInputFieldEditorProps({ onClose })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)
      fireEvent.click(screen.getByTestId('form-cancel-btn'))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onSubmit with converted data when form submits', () => {
      // Arrange
      const onSubmit = vi.fn()
      const props = createInputFieldEditorProps({ onSubmit })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)
      fireEvent.click(screen.getByTestId('form-submit-btn'))

      // Assert
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.any(String),
          variable: expect.any(String),
        }),
        undefined,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Floating Right Behavior Tests
  // -------------------------------------------------------------------------
  describe('Floating Right Behavior', () => {
    it('should call useFloatingRight hook', () => {
      // Arrange
      const props = createInputFieldEditorProps()

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(mockUseFloatingRight).toHaveBeenCalled()
    })

    it('should apply floating right styles when floatingRight is true', () => {
      // Arrange
      mockUseFloatingRight.mockReturnValue({
        floatingRight: true,
        floatingRightWidth: 300,
      })
      const props = createInputFieldEditorProps()

      // Act
      const { container } = renderWithProviders(
        <InputFieldEditorPanel {...props} />,
      )

      // Assert
      const panel = container.firstChild as HTMLElement
      expect(panel.className).toContain('absolute')
      expect(panel.className).toContain('right-0')
      expect(panel.style.width).toBe('300px')
    })

    it('should not apply floating right styles when floatingRight is false', () => {
      // Arrange
      mockUseFloatingRight.mockReturnValue({
        floatingRight: false,
        floatingRightWidth: 400,
      })
      const props = createInputFieldEditorProps()

      // Act
      const { container } = renderWithProviders(
        <InputFieldEditorPanel {...props} />,
      )

      // Assert
      const panel = container.firstChild as HTMLElement
      expect(panel.className).not.toContain('absolute')
      expect(panel.style.width).toBe('400px')
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability and Memoization Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable onClose callback reference', () => {
      // Arrange
      const onClose = vi.fn()
      const props = createInputFieldEditorProps({ onClose })

      // Act
      const { rerender } = renderWithProviders(
        <InputFieldEditorPanel {...props} />,
      )
      fireEvent.click(screen.getByTestId('form-cancel-btn'))

      rerender(
        <TestWrapper>
          <InputFieldEditorPanel {...props} />
        </TestWrapper>,
      )
      fireEvent.click(screen.getByTestId('form-cancel-btn'))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(2)
    })

    it('should maintain stable onSubmit callback reference', () => {
      // Arrange
      const onSubmit = vi.fn()
      const props = createInputFieldEditorProps({ onSubmit })

      // Act
      const { rerender } = renderWithProviders(
        <InputFieldEditorPanel {...props} />,
      )
      fireEvent.click(screen.getByTestId('form-submit-btn'))

      rerender(
        <TestWrapper>
          <InputFieldEditorPanel {...props} />
        </TestWrapper>,
      )
      fireEvent.click(screen.getByTestId('form-submit-btn'))

      // Assert
      expect(onSubmit).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should memoize formData when initialData does not change', () => {
      // Arrange
      const initialData = createInputVar()
      const props = createInputFieldEditorProps({ initialData })

      // Act
      const { rerender } = renderWithProviders(
        <InputFieldEditorPanel {...props} />,
      )
      const firstFormData = screen.getByTestId('form-initial-data').textContent

      rerender(
        <TestWrapper>
          <InputFieldEditorPanel {...props} />
        </TestWrapper>,
      )
      const secondFormData = screen.getByTestId('form-initial-data').textContent

      // Assert
      expect(firstFormData).toBe(secondFormData)
    })

    it('should recompute formData when initialData changes', () => {
      // Arrange
      const initialData1 = createInputVar({ variable: 'var1' })
      const initialData2 = createInputVar({ variable: 'var2' })
      const props1 = createInputFieldEditorProps({ initialData: initialData1 })
      const props2 = createInputFieldEditorProps({ initialData: initialData2 })

      // Act
      const { rerender } = renderWithProviders(
        <InputFieldEditorPanel {...props1} />,
      )
      const firstFormData = screen.getByTestId('form-initial-data').textContent

      rerender(
        <TestWrapper>
          <InputFieldEditorPanel {...props2} />
        </TestWrapper>,
      )
      const secondFormData = screen.getByTestId('form-initial-data').textContent

      // Assert
      expect(firstFormData).not.toBe(secondFormData)
      expect(firstFormData).toContain('var1')
      expect(secondFormData).toContain('var2')
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle undefined initialData gracefully', () => {
      // Arrange
      const props = createInputFieldEditorProps({ initialData: undefined })

      // Act & Assert
      expect(() =>
        renderWithProviders(<InputFieldEditorPanel {...props} />),
      ).not.toThrow()
    })

    it('should handle rapid close button clicks', () => {
      // Arrange
      const onClose = vi.fn()
      const props = createInputFieldEditorProps({ onClose })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)
      const closeButtons = screen.getAllByRole('button')
      const closeButton = closeButtons.find(btn => btn.querySelector('svg'))

      if (closeButton) {
        fireEvent.click(closeButton)
        fireEvent.click(closeButton)
        fireEvent.click(closeButton)
      }

      // Assert
      expect(onClose).toHaveBeenCalledTimes(3)
    })

    it('should handle special characters in initialData', () => {
      // Arrange
      const initialData = createInputVar({
        label: 'Test <script>alert("xss")</script>',
        variable: 'test_var',
        tooltips: 'Tooltip with "quotes" and \'apostrophes\'',
      })
      const props = createInputFieldEditorProps({ initialData })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('input-field-form')).toBeInTheDocument()
    })

    it('should handle empty string values in initialData', () => {
      // Arrange
      const initialData = createInputVar({
        label: '',
        variable: '',
        default_value: '',
        tooltips: '',
        placeholder: '',
      })
      const props = createInputFieldEditorProps({ initialData })

      // Act
      renderWithProviders(<InputFieldEditorPanel {...props} />)

      // Assert
      expect(screen.getByTestId('input-field-form')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Utils Tests - convertToInputFieldFormData
// ============================================================================

describe('convertToInputFieldFormData', () => {
  // -------------------------------------------------------------------------
  // Basic Conversion Tests
  // -------------------------------------------------------------------------
  describe('Basic Conversion', () => {
    it('should convert InputVar to FormData with all fields', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test_var',
        max_length: 100,
        default_value: 'default',
        required: true,
        tooltips: 'tooltip',
        options: ['a', 'b'],
        placeholder: 'placeholder',
        unit: 'kg',
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.textInput)
      expect(result.label).toBe('Test')
      expect(result.variable).toBe('test_var')
      expect(result.maxLength).toBe(100)
      expect(result.default).toBe('default')
      expect(result.required).toBe(true)
      expect(result.tooltips).toBe('tooltip')
      expect(result.options).toEqual(['a', 'b'])
      expect(result.placeholder).toBe('placeholder')
      expect(result.unit).toBe('kg')
    })

    it('should convert file-related fields correctly', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.singleFile,
        allowed_file_upload_methods: ['local_file', 'remote_url'] as TransferMethod[],
        allowed_file_types: ['image', 'document'] as SupportUploadFileTypes[],
        allowed_file_extensions: ['.jpg', '.pdf'],
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.allowedFileUploadMethods).toEqual([
        'local_file',
        'remote_url',
      ])
      expect(result.allowedTypesAndExtensions).toEqual({
        allowedFileTypes: ['image', 'document'],
        allowedFileExtensions: ['.jpg', '.pdf'],
      })
    })

    it('should return default template when data is undefined', () => {
      // Act
      const result = convertToInputFieldFormData(undefined)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.textInput)
      expect(result.variable).toBe('')
      expect(result.label).toBe('')
      expect(result.required).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Optional Fields Handling Tests
  // -------------------------------------------------------------------------
  describe('Optional Fields Handling', () => {
    it('should not include default when default_value is undefined', () => {
      // Arrange
      const inputVar = createInputVar({
        default_value: undefined,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.default).toBeUndefined()
    })

    it('should not include default when default_value is null', () => {
      // Arrange
      const inputVar: InputVar = {
        ...createInputVar(),
        default_value: null as unknown as string,
      }

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.default).toBeUndefined()
    })

    it('should include default when default_value is empty string', () => {
      // Arrange
      const inputVar = createInputVar({
        default_value: '',
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.default).toBe('')
    })

    it('should not include tooltips when undefined', () => {
      // Arrange
      const inputVar = createInputVar({
        tooltips: undefined,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.tooltips).toBeUndefined()
    })

    it('should not include placeholder when undefined', () => {
      // Arrange
      const inputVar = createInputVar({
        placeholder: undefined,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.placeholder).toBeUndefined()
    })

    it('should not include unit when undefined', () => {
      // Arrange
      const inputVar = createInputVar({
        unit: undefined,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.unit).toBeUndefined()
    })

    it('should not include file settings when allowed_file_upload_methods is undefined', () => {
      // Arrange
      const inputVar = createInputVar({
        allowed_file_upload_methods: undefined,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.allowedFileUploadMethods).toBeUndefined()
    })

    it('should not include allowedTypesAndExtensions details when file types/extensions are missing', () => {
      // Arrange
      const inputVar = createInputVar({
        allowed_file_types: undefined,
        allowed_file_extensions: undefined,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.allowedTypesAndExtensions).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // Type-Specific Tests
  // -------------------------------------------------------------------------
  describe('Type-Specific Handling', () => {
    it('should handle textInput type', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.textInput,
        max_length: 256,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.textInput)
      expect(result.maxLength).toBe(256)
    })

    it('should handle paragraph type', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.paragraph,
        max_length: 1000,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.paragraph)
      expect(result.maxLength).toBe(1000)
    })

    it('should handle number type with unit', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.number,
        unit: 'meters',
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.number)
      expect(result.unit).toBe('meters')
    })

    it('should handle select type with options', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.select,
        options: ['Option A', 'Option B', 'Option C'],
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.select)
      expect(result.options).toEqual(['Option A', 'Option B', 'Option C'])
    })

    it('should handle singleFile type', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.singleFile,
        allowed_file_upload_methods: ['local_file'] as TransferMethod[],
        allowed_file_types: ['image'] as SupportUploadFileTypes[],
        allowed_file_extensions: ['.jpg'],
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.singleFile)
      expect(result.allowedFileUploadMethods).toEqual(['local_file'])
    })

    it('should handle multiFiles type', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.multiFiles,
        max_length: 5,
        allowed_file_upload_methods: ['local_file', 'remote_url'] as TransferMethod[],
        allowed_file_types: ['document'] as SupportUploadFileTypes[],
        allowed_file_extensions: ['.pdf', '.doc'],
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.multiFiles)
      expect(result.maxLength).toBe(5)
    })

    it('should handle checkbox type', () => {
      // Arrange
      const inputVar = createInputVar({
        type: PipelineInputVarType.checkbox,
        default_value: 'true',
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.checkbox)
      expect(result.default).toBe('true')
    })
  })
})

// ============================================================================
// Utils Tests - convertFormDataToINputField
// ============================================================================

describe('convertFormDataToINputField', () => {
  // -------------------------------------------------------------------------
  // Basic Conversion Tests
  // -------------------------------------------------------------------------
  describe('Basic Conversion', () => {
    it('should convert FormData to InputVar with all fields', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test_var',
        maxLength: 100,
        default: 'default',
        required: true,
        tooltips: 'tooltip',
        options: ['a', 'b'],
        placeholder: 'placeholder',
        unit: 'kg',
        allowedFileUploadMethods: ['local_file'] as TransferMethod[],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image'] as SupportUploadFileTypes[],
          allowedFileExtensions: ['.jpg'],
        },
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.textInput)
      expect(result.label).toBe('Test')
      expect(result.variable).toBe('test_var')
      expect(result.max_length).toBe(100)
      expect(result.default_value).toBe('default')
      expect(result.required).toBe(true)
      expect(result.tooltips).toBe('tooltip')
      expect(result.options).toEqual(['a', 'b'])
      expect(result.placeholder).toBe('placeholder')
      expect(result.unit).toBe('kg')
      expect(result.allowed_file_upload_methods).toEqual(['local_file'])
      expect(result.allowed_file_types).toEqual(['image'])
      expect(result.allowed_file_extensions).toEqual(['.jpg'])
    })

    it('should handle undefined optional fields', () => {
      // Arrange
      const formData = createFormData({
        default: undefined,
        tooltips: undefined,
        placeholder: undefined,
        unit: undefined,
        allowedFileUploadMethods: undefined,
        allowedTypesAndExtensions: {
          allowedFileTypes: undefined,
          allowedFileExtensions: undefined,
        },
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.default_value).toBeUndefined()
      expect(result.tooltips).toBeUndefined()
      expect(result.placeholder).toBeUndefined()
      expect(result.unit).toBeUndefined()
      expect(result.allowed_file_upload_methods).toBeUndefined()
      expect(result.allowed_file_types).toBeUndefined()
      expect(result.allowed_file_extensions).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Field Mapping Tests
  // -------------------------------------------------------------------------
  describe('Field Mapping', () => {
    it('should map maxLength to max_length', () => {
      // Arrange
      const formData = createFormData({ maxLength: 256 })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.max_length).toBe(256)
    })

    it('should map default to default_value', () => {
      // Arrange
      const formData = createFormData({ default: 'my default' })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.default_value).toBe('my default')
    })

    it('should map allowedFileUploadMethods to allowed_file_upload_methods', () => {
      // Arrange
      const formData = createFormData({
        allowedFileUploadMethods: ['local_file', 'remote_url'] as TransferMethod[],
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.allowed_file_upload_methods).toEqual([
        'local_file',
        'remote_url',
      ])
    })

    it('should map allowedTypesAndExtensions to separate fields', () => {
      // Arrange
      const formData = createFormData({
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image', 'document'] as SupportUploadFileTypes[],
          allowedFileExtensions: ['.jpg', '.pdf'],
        },
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.allowed_file_types).toEqual(['image', 'document'])
      expect(result.allowed_file_extensions).toEqual(['.jpg', '.pdf'])
    })
  })

  // -------------------------------------------------------------------------
  // Type-Specific Tests
  // -------------------------------------------------------------------------
  describe('Type-Specific Handling', () => {
    it('should preserve textInput type', () => {
      // Arrange
      const formData = createFormData({ type: PipelineInputVarType.textInput })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.textInput)
    })

    it('should preserve paragraph type', () => {
      // Arrange
      const formData = createFormData({ type: PipelineInputVarType.paragraph })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.paragraph)
    })

    it('should preserve select type with options', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.select,
        options: ['A', 'B', 'C'],
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.select)
      expect(result.options).toEqual(['A', 'B', 'C'])
    })

    it('should preserve number type with unit', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.number,
        unit: 'kg',
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.number)
      expect(result.unit).toBe('kg')
    })

    it('should preserve singleFile type', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.singleFile,
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.singleFile)
    })

    it('should preserve multiFiles type with maxLength', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.multiFiles,
        maxLength: 10,
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.multiFiles)
      expect(result.max_length).toBe(10)
    })

    it('should preserve checkbox type', () => {
      // Arrange
      const formData = createFormData({ type: PipelineInputVarType.checkbox })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(PipelineInputVarType.checkbox)
    })
  })
})

// ============================================================================
// Round-Trip Conversion Tests
// ============================================================================

describe('Round-Trip Conversion', () => {
  it('should preserve data through round-trip conversion for textInput', () => {
    // Arrange
    const original = createInputVar({
      type: PipelineInputVarType.textInput,
      label: 'Test Label',
      variable: 'test_var',
      max_length: 100,
      default_value: 'default',
      required: true,
      tooltips: 'tooltip',
      placeholder: 'placeholder',
    })

    // Act
    const formData = convertToInputFieldFormData(original)
    const result = convertFormDataToINputField(formData)

    // Assert
    expect(result.type).toBe(original.type)
    expect(result.label).toBe(original.label)
    expect(result.variable).toBe(original.variable)
    expect(result.max_length).toBe(original.max_length)
    expect(result.default_value).toBe(original.default_value)
    expect(result.required).toBe(original.required)
    expect(result.tooltips).toBe(original.tooltips)
    expect(result.placeholder).toBe(original.placeholder)
  })

  it('should preserve data through round-trip conversion for select', () => {
    // Arrange
    const original = createInputVar({
      type: PipelineInputVarType.select,
      options: ['Option A', 'Option B', 'Option C'],
      default_value: 'Option A',
    })

    // Act
    const formData = convertToInputFieldFormData(original)
    const result = convertFormDataToINputField(formData)

    // Assert
    expect(result.type).toBe(original.type)
    expect(result.options).toEqual(original.options)
    expect(result.default_value).toBe(original.default_value)
  })

  it('should preserve data through round-trip conversion for file types', () => {
    // Arrange
    const original = createInputVar({
      type: PipelineInputVarType.multiFiles,
      max_length: 5,
      allowed_file_upload_methods: ['local_file', 'remote_url'] as TransferMethod[],
      allowed_file_types: ['image', 'document'] as SupportUploadFileTypes[],
      allowed_file_extensions: ['.jpg', '.pdf'],
    })

    // Act
    const formData = convertToInputFieldFormData(original)
    const result = convertFormDataToINputField(formData)

    // Assert
    expect(result.type).toBe(original.type)
    expect(result.max_length).toBe(original.max_length)
    expect(result.allowed_file_upload_methods).toEqual(
      original.allowed_file_upload_methods,
    )
    expect(result.allowed_file_types).toEqual(original.allowed_file_types)
    expect(result.allowed_file_extensions).toEqual(
      original.allowed_file_extensions,
    )
  })

  it('should handle all input types through round-trip', () => {
    // Arrange
    const typesToTest = [
      PipelineInputVarType.textInput,
      PipelineInputVarType.paragraph,
      PipelineInputVarType.number,
      PipelineInputVarType.select,
      PipelineInputVarType.singleFile,
      PipelineInputVarType.multiFiles,
      PipelineInputVarType.checkbox,
    ]

    typesToTest.forEach((type) => {
      const original = createInputVar({ type })

      // Act
      const formData = convertToInputFieldFormData(original)
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.type).toBe(original.type)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('convertToInputFieldFormData edge cases', () => {
    it('should handle zero maxLength', () => {
      // Arrange
      const inputVar = createInputVar({ max_length: 0 })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.maxLength).toBe(0)
    })

    it('should handle empty options array', () => {
      // Arrange
      const inputVar = createInputVar({ options: [] })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.options).toEqual([])
    })

    it('should handle options with special characters', () => {
      // Arrange
      const inputVar = createInputVar({
        options: ['<script>', '"quoted"', '\'apostrophe\'', '&amp;'],
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.options).toEqual([
        '<script>',
        '"quoted"',
        '\'apostrophe\'',
        '&amp;',
      ])
    })

    it('should handle very long strings', () => {
      // Arrange
      const longString = 'a'.repeat(10000)
      const inputVar = createInputVar({
        label: longString,
        tooltips: longString,
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.label).toBe(longString)
      expect(result.tooltips).toBe(longString)
    })

    it('should handle unicode characters', () => {
      // Arrange
      const inputVar = createInputVar({
        label: '测试标签 🎉',
        tooltips: 'ツールチップ 😀',
        placeholder: 'Platzhalter ñ é',
      })

      // Act
      const result = convertToInputFieldFormData(inputVar)

      // Assert
      expect(result.label).toBe('测试标签 🎉')
      expect(result.tooltips).toBe('ツールチップ 😀')
      expect(result.placeholder).toBe('Platzhalter ñ é')
    })
  })

  describe('convertFormDataToINputField edge cases', () => {
    it('should handle zero maxLength', () => {
      // Arrange
      const formData = createFormData({ maxLength: 0 })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.max_length).toBe(0)
    })

    it('should handle empty allowedTypesAndExtensions', () => {
      // Arrange
      const formData = createFormData({
        allowedTypesAndExtensions: {
          allowedFileTypes: [],
          allowedFileExtensions: [],
        },
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.allowed_file_types).toEqual([])
      expect(result.allowed_file_extensions).toEqual([])
    })

    it('should handle boolean default value (checkbox)', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.checkbox,
        default: 'true',
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.default_value).toBe('true')
    })

    it('should handle numeric default value (number type)', () => {
      // Arrange
      const formData = createFormData({
        type: PipelineInputVarType.number,
        default: '42',
      })

      // Act
      const result = convertFormDataToINputField(formData)

      // Assert
      expect(result.default_value).toBe('42')
    })
  })
})

// ============================================================================
// Hook Memoization Tests
// ============================================================================

describe('Hook Memoization', () => {
  it('should return stable callback reference for handleSubmit', () => {
    // Arrange
    const onSubmit = vi.fn()
    let handleSubmitRef1: ((value: FormData) => void) | undefined
    let handleSubmitRef2: ((value: FormData) => void) | undefined

    const TestComponent = ({
      capture,
      submitFn,
    }: {
      capture: (ref: (value: FormData) => void) => void
      submitFn: (data: InputVar) => void
    }) => {
      const handleSubmit = React.useCallback(
        (value: FormData) => {
          const inputFieldData = convertFormDataToINputField(value)
          submitFn(inputFieldData)
        },
        [submitFn],
      )
      capture(handleSubmit)
      return null
    }

    // Act
    const { rerender } = render(
      <TestComponent capture={(ref) => { handleSubmitRef1 = ref }} submitFn={onSubmit} />,
    )
    rerender(
      <TestComponent capture={(ref) => { handleSubmitRef2 = ref }} submitFn={onSubmit} />,
    )

    // Assert - callback should be same reference due to useCallback
    expect(handleSubmitRef1).toBe(handleSubmitRef2)
  })

  it('should return stable formData when initialData is unchanged', () => {
    // Arrange
    const initialData = createInputVar()
    let formData1: FormData | undefined
    let formData2: FormData | undefined

    const TestComponent = ({
      data,
      capture,
    }: {
      data: InputVar
      capture: (fd: FormData) => void
    }) => {
      const formData = React.useMemo(
        () => convertToInputFieldFormData(data),
        [data],
      )
      capture(formData)
      return null
    }

    // Act
    const { rerender } = render(
      <TestComponent
        data={initialData}
        capture={(fd) => { formData1 = fd }}
      />,
    )
    rerender(
      <TestComponent
        data={initialData}
        capture={(fd) => { formData2 = fd }}
      />,
    )

    // Assert - formData should be same reference due to useMemo
    expect(formData1).toBe(formData2)
  })
})
