import type { FormData, InputFieldFormProps } from './types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useConfigurations, useHiddenConfigurations, useHiddenFieldNames } from './hooks'
import InputFieldForm from './index'
import { createInputFieldSchema, TEXT_MAX_LENGTH } from './schema'

// Type helper for partial listener event parameters in tests
// Using double assertion for test mocks with incomplete event objects
const createMockEvent = <T,>(value: T) => ({ value }) as unknown as Parameters<NonNullable<NonNullable<ReturnType<typeof useConfigurations>[number]['listeners']>['onChange']>>[0]

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock file upload config service
const mockFileUploadConfig = {
  image_file_size_limit: 10,
  file_size_limit: 15,
  audio_file_size_limit: 50,
  video_file_size_limit: 100,
  workflow_file_upload_limit: 10,
}

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: mockFileUploadConfig,
    isLoading: false,
    error: null,
  }),
}))

// Mock Toast static method
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// ============================================================================
// Test Data Factories
// ============================================================================

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

const createInputFieldFormProps = (overrides?: Partial<InputFieldFormProps>): InputFieldFormProps => ({
  initialData: createFormData(),
  supportFile: false,
  onCancel: vi.fn(),
  onSubmit: vi.fn(),
  isEditMode: true,
  ...overrides,
})

// ============================================================================
// Test Wrapper Component
// ============================================================================

const createTestQueryClient = () => new QueryClient({
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
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper })
}

const renderHookWithProviders = <TResult,>(hook: () => TResult) => {
  return renderHook(hook, { wrapper: TestWrapper })
}

// ============================================================================
// InputFieldForm Component Tests
// ============================================================================

describe('InputFieldForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render form without crashing', () => {
      // Arrange
      const props = createInputFieldFormProps()

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      // Arrange
      const props = createInputFieldFormProps()

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should render form with initial values', () => {
      // Arrange
      const initialData = createFormData({
        variable: 'custom_var',
        label: 'Custom Label',
      })
      const props = createInputFieldFormProps({ initialData })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Props Variations Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should handle supportFile=true prop', () => {
      // Arrange
      const props = createInputFieldFormProps({ supportFile: true })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle supportFile=false (default) prop', () => {
      // Arrange
      const props = createInputFieldFormProps({ supportFile: false })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle isEditMode=true prop', () => {
      // Arrange
      const props = createInputFieldFormProps({ isEditMode: true })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle isEditMode=false prop', () => {
      // Arrange
      const props = createInputFieldFormProps({ isEditMode: false })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle different initial data types', () => {
      // Arrange
      const typesToTest = [
        PipelineInputVarType.textInput,
        PipelineInputVarType.paragraph,
        PipelineInputVarType.number,
        PipelineInputVarType.select,
        PipelineInputVarType.checkbox,
      ]

      typesToTest.forEach((type) => {
        const initialData = createFormData({ type })
        const props = createInputFieldFormProps({ initialData })

        // Act
        const { container, unmount } = renderWithProviders(<InputFieldForm {...props} />)

        // Assert
        expect(container.querySelector('form')).toBeInTheDocument()
        unmount()
      })
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      // Arrange
      const onCancel = vi.fn()
      const props = createInputFieldFormProps({ onCancel })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      // Assert
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should prevent default on form submit', async () => {
      // Arrange
      const props = createInputFieldFormProps()
      const { container } = renderWithProviders(<InputFieldForm {...props} />)
      const form = container.querySelector('form')!
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })

      // Act
      form.dispatchEvent(submitEvent)

      // Assert
      expect(submitEvent.defaultPrevented).toBe(true)
    })

    it('should show Toast error when form validation fails on submit', async () => {
      // Arrange - Create invalid form data with empty variable name (validation should fail)
      const Toast = await import('@/app/components/base/toast')
      const initialData = createFormData({
        variable: '', // Empty variable should fail validation
        label: 'Test Label',
      })
      const onSubmit = vi.fn()
      const props = createInputFieldFormProps({ initialData, onSubmit })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      // Assert - Toast should be called with error message when validation fails
      await waitFor(() => {
        expect(Toast.default.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            message: expect.any(String),
          }),
        )
      })
      // onSubmit should not be called when validation fails
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should call onSubmit with moreInfo when variable name changes in edit mode', async () => {
      // Arrange - Initial variable name is 'original_var', we change it to 'new_var'
      const initialData = createFormData({
        variable: 'original_var',
        label: 'Test Label',
      })
      const onSubmit = vi.fn()
      const props = createInputFieldFormProps({
        initialData,
        onSubmit,
        isEditMode: true,
      })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Find and change the variable input by label
      const variableInput = screen.getByLabelText('appDebug.variableConfig.varName')
      fireEvent.change(variableInput, { target: { value: 'new_var' } })

      // Submit the form
      const form = document.querySelector('form')!
      fireEvent.submit(form)

      // Assert - onSubmit should be called with moreInfo containing variable name change info
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            variable: 'new_var',
          }),
          expect.objectContaining({
            type: 'changeVarName',
            payload: {
              beforeKey: 'original_var',
              afterKey: 'new_var',
            },
          }),
        )
      })
    })

    it('should call onSubmit without moreInfo when variable name does not change in edit mode', async () => {
      // Arrange - Variable name stays the same
      const initialData = createFormData({
        variable: 'same_var',
        label: 'Test Label',
      })
      const onSubmit = vi.fn()
      const props = createInputFieldFormProps({
        initialData,
        onSubmit,
        isEditMode: true,
      })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Submit without changing variable name
      const form = document.querySelector('form')!
      fireEvent.submit(form)

      // Assert - onSubmit should be called without moreInfo (undefined)
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            variable: 'same_var',
          }),
          undefined,
        )
      })
    })

    it('should call onSubmit without moreInfo when not in edit mode', async () => {
      // Arrange
      const initialData = createFormData({
        variable: 'test_var',
        label: 'Test Label',
      })
      const onSubmit = vi.fn()
      const props = createInputFieldFormProps({
        initialData,
        onSubmit,
        isEditMode: false,
      })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Submit the form
      const form = document.querySelector('form')!
      fireEvent.submit(form)

      // Assert - onSubmit should be called without moreInfo since not in edit mode
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.any(Object),
          undefined,
        )
      })
    })
  })

  // -------------------------------------------------------------------------
  // State Management Tests
  // -------------------------------------------------------------------------
  describe('State Management', () => {
    it('should initialize showAllSettings state as false', () => {
      // Arrange
      const props = createInputFieldFormProps()

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Assert - ShowAllSettings component should be visible when showAllSettings is false
      expect(screen.queryByText(/appDebug.variableConfig.showAllSettings/i)).toBeInTheDocument()
    })

    it('should toggle showAllSettings state when clicking show all settings', async () => {
      // Arrange
      const props = createInputFieldFormProps()
      renderWithProviders(<InputFieldForm {...props} />)

      // Act - Find and click the show all settings element
      const showAllSettingsElement = screen.getByText(/appDebug.variableConfig.showAllSettings/i)
      const clickableParent = showAllSettingsElement.closest('.cursor-pointer')
      if (clickableParent) {
        fireEvent.click(clickableParent)
      }

      // Assert - After clicking, ShowAllSettings should be hidden and HiddenFields should be visible
      await waitFor(() => {
        expect(screen.queryByText(/appDebug.variableConfig.showAllSettings/i)).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable onCancel callback reference', () => {
      // Arrange
      const onCancel = vi.fn()
      const props = createInputFieldFormProps({ onCancel })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)
      fireEvent.click(cancelButton)

      // Assert
      expect(onCancel).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty initial data gracefully', () => {
      // Arrange
      const props = createInputFieldFormProps({
        initialData: {} as Record<string, unknown>,
      })

      // Act & Assert - should not crash
      expect(() => renderWithProviders(<InputFieldForm {...props} />)).not.toThrow()
    })

    it('should handle undefined optional fields', () => {
      // Arrange
      const initialData = {
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test',
        required: true,
        allowedTypesAndExtensions: {
          allowedFileTypes: [],
          allowedFileExtensions: [],
        },
        // Other fields are undefined
      }
      const props = createInputFieldFormProps({ initialData })

      // Act & Assert
      expect(() => renderWithProviders(<InputFieldForm {...props} />)).not.toThrow()
    })

    it('should handle special characters in variable name', () => {
      // Arrange
      const initialData = createFormData({
        variable: 'test_var_123',
        label: 'Test Label <script>',
      })
      const props = createInputFieldFormProps({ initialData })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// useHiddenFieldNames Hook Tests
// ============================================================================

describe('useHiddenFieldNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Return Value Tests for Different Types
  // -------------------------------------------------------------------------
  describe('Return Values by Type', () => {
    it('should return correct field names for textInput type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.textInput),
      )

      // Assert - should include default value, placeholder, tooltips
      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.placeholder'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for paragraph type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.paragraph),
      )

      // Assert
      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.placeholder'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for number type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.number),
      )

      // Assert - should include unit field
      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.unit'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.placeholder'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for select type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.select),
      )

      // Assert
      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for singleFile type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.singleFile),
      )

      // Assert
      expect(result.current).toContain('appDebug.variableConfig.uploadMethod'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for multiFiles type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.multiFiles),
      )

      // Assert
      expect(result.current).toContain('appDebug.variableConfig.uploadMethod'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.maxNumberOfUploads'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for checkbox type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.checkbox),
      )

      // Assert
      expect(result.current).toContain('appDebug.variableConfig.startChecked'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should return tooltips only for unknown type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames('unknown_type' as PipelineInputVarType),
      )

      // Assert - should only contain tooltips for unknown types
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })
  })
})

// ============================================================================
// useConfigurations Hook Tests
// ============================================================================

describe('useConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Configuration Generation Tests
  // -------------------------------------------------------------------------
  describe('Configuration Generation', () => {
    it('should return array of configurations', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Assert
      expect(Array.isArray(result.current)).toBe(true)
      expect(result.current.length).toBeGreaterThan(0)
    })

    it('should include type field configuration', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Assert
      const typeConfig = result.current.find(config => config.variable === 'type')
      expect(typeConfig).toBeDefined()
      expect(typeConfig?.required).toBe(true)
    })

    it('should include variable field configuration', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Assert
      const variableConfig = result.current.find(config => config.variable === 'variable')
      expect(variableConfig).toBeDefined()
      expect(variableConfig?.required).toBe(true)
    })

    it('should include label field configuration', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Assert
      const labelConfig = result.current.find(config => config.variable === 'label')
      expect(labelConfig).toBeDefined()
      expect(labelConfig?.required).toBe(false)
    })

    it('should include required field configuration', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Assert
      const requiredConfig = result.current.find(config => config.variable === 'required')
      expect(requiredConfig).toBeDefined()
    })

    it('should pass supportFile prop to type configuration', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: true,
        }),
      )

      // Assert
      const typeConfig = result.current.find(config => config.variable === 'type')
      expect(typeConfig?.supportFile).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Callback Tests
  // -------------------------------------------------------------------------
  describe('Callbacks', () => {
    it('should call setFieldValue when type changes to singleFile', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: true,
        }),
      )

      // Act
      const typeConfig = result.current.find(config => config.variable === 'type')
      typeConfig?.listeners?.onChange?.(createMockEvent(PipelineInputVarType.singleFile))

      // Assert
      expect(mockSetFieldValue).toHaveBeenCalledWith('allowedFileUploadMethods', expect.any(Array))
      expect(mockSetFieldValue).toHaveBeenCalledWith('allowedTypesAndExtensions', expect.any(Object))
    })

    it('should call setFieldValue when type changes to multiFiles', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: true,
        }),
      )

      // Act
      const typeConfig = result.current.find(config => config.variable === 'type')
      typeConfig?.listeners?.onChange?.(createMockEvent(PipelineInputVarType.multiFiles))

      // Assert
      expect(mockSetFieldValue).toHaveBeenCalledWith('maxLength', expect.any(Number))
    })

    it('should set label from variable name on blur when label is empty', () => {
      // Arrange
      const mockGetFieldValue = vi.fn().mockReturnValue('')
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Act
      const variableConfig = result.current.find(config => config.variable === 'variable')
      variableConfig?.listeners?.onBlur?.(createMockEvent('test_variable'))

      // Assert
      expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'test_variable')
    })

    it('should not set label from variable name on blur when label is not empty', () => {
      // Arrange
      const mockGetFieldValue = vi.fn().mockReturnValue('Existing Label')
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Act
      const variableConfig = result.current.find(config => config.variable === 'variable')
      variableConfig?.listeners?.onBlur?.(createMockEvent('test_variable'))

      // Assert
      expect(mockSetFieldValue).not.toHaveBeenCalled()
    })

    it('should reset label to variable name when display name is cleared', () => {
      // Arrange
      const mockGetFieldValue = vi.fn().mockReturnValue('original_var')
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Act
      const labelConfig = result.current.find(config => config.variable === 'label')
      labelConfig?.listeners?.onBlur?.(createMockEvent(''))

      // Assert
      expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'original_var')
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should return configurations array with correct length', () => {
      // Arrange
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      // Act
      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      // Assert - should have all expected field configurations
      expect(result.current.length).toBe(8) // type, variable, label, maxLength, options, fileTypes x2, required
    })
  })
})

// ============================================================================
// useHiddenConfigurations Hook Tests
// ============================================================================

describe('useHiddenConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Configuration Generation Tests
  // -------------------------------------------------------------------------
  describe('Configuration Generation', () => {
    it('should return array of hidden configurations', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      expect(Array.isArray(result.current)).toBe(true)
      expect(result.current.length).toBeGreaterThan(0)
    })

    it('should include default value configurations for different types', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const defaultConfigs = result.current.filter(config => config.variable === 'default')
      expect(defaultConfigs.length).toBeGreaterThan(0)
    })

    it('should include tooltips configuration', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const tooltipsConfig = result.current.find(config => config.variable === 'tooltips')
      expect(tooltipsConfig).toBeDefined()
      expect(tooltipsConfig?.showConditions).toEqual([])
    })

    it('should include placeholder configurations', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const placeholderConfigs = result.current.filter(config => config.variable === 'placeholder')
      expect(placeholderConfigs.length).toBeGreaterThan(0)
    })

    it('should include unit configuration for number type', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const unitConfig = result.current.find(config => config.variable === 'unit')
      expect(unitConfig).toBeDefined()
      expect(unitConfig?.showConditions).toContainEqual({
        variable: 'type',
        value: PipelineInputVarType.number,
      })
    })

    it('should include upload method configurations for file types', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const uploadMethodConfigs = result.current.filter(
        config => config.variable === 'allowedFileUploadMethods',
      )
      expect(uploadMethodConfigs.length).toBe(2) // One for singleFile, one for multiFiles
    })

    it('should include maxLength configuration for multiFiles', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const maxLengthConfig = result.current.find(
        config => config.variable === 'maxLength'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.multiFiles),
      )
      expect(maxLengthConfig).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Options Handling Tests
  // -------------------------------------------------------------------------
  describe('Options Handling', () => {
    it('should generate select options from provided options array', () => {
      // Arrange
      const options = ['Option A', 'Option B', 'Option C']

      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options }),
      )

      // Assert
      const selectConfig = result.current.find(
        config => config.variable === 'default'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.select),
      )
      expect(selectConfig?.options).toBeDefined()
      expect(selectConfig?.options?.length).toBe(4) // 3 options + 1 "no default" option
    })

    it('should include "no default selected" option', () => {
      // Arrange
      const options = ['Option A']

      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options }),
      )

      // Assert
      const selectConfig = result.current.find(
        config => config.variable === 'default'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.select),
      )
      const noDefaultOption = selectConfig?.options?.find(opt => opt.value === '')
      expect(noDefaultOption).toBeDefined()
    })

    it('should return empty options when options is undefined', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const selectConfig = result.current.find(
        config => config.variable === 'default'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.select),
      )
      expect(selectConfig?.options).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // File Size Limit Integration Tests
  // -------------------------------------------------------------------------
  describe('File Size Limit Integration', () => {
    it('should include file size description in maxLength config', () => {
      // Act
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      // Assert
      const maxLengthConfig = result.current.find(
        config => config.variable === 'maxLength'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.multiFiles),
      )
      expect(maxLengthConfig?.description).toBeDefined()
    })
  })
})

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('createInputFieldSchema', () => {
  // Mock translation function - cast to any to satisfy TFunction type requirements
  const mockT = ((key: string) => key) as unknown as Parameters<typeof createInputFieldSchema>[1]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Common Schema Tests
  // -------------------------------------------------------------------------
  describe('Common Schema Validation', () => {
    it('should validate required variable field', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = { variable: '', label: 'Test', required: true, type: 'text-input' }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should validate variable max length', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'a'.repeat(100),
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should validate variable does not start with number', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: '123var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should validate variable format (alphanumeric and underscore)', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'var-name',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should accept valid variable name', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'valid_var_123',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should validate required label field', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: '',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Text Input Schema Tests
  // -------------------------------------------------------------------------
  describe('Text Input Schema', () => {
    it('should validate maxLength within bounds', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 100,
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should reject maxLength exceeding TEXT_MAX_LENGTH', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: TEXT_MAX_LENGTH + 1,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should reject maxLength less than 1', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 0,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should allow optional default value', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
        default: 'default value',
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Paragraph Schema Tests
  // -------------------------------------------------------------------------
  describe('Paragraph Schema', () => {
    it('should validate paragraph type similar to textInput', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.paragraph, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'paragraph',
        maxLength: 100,
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Number Schema Tests
  // -------------------------------------------------------------------------
  describe('Number Schema', () => {
    it('should allow optional default number', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.number, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'number',
        default: 42,
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should allow optional unit', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.number, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'number',
        unit: 'kg',
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Select Schema Tests
  // -------------------------------------------------------------------------
  describe('Select Schema', () => {
    it('should require non-empty options array', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.select, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'select',
        options: [],
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })

    it('should accept valid options array', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.select, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'select',
        options: ['Option 1', 'Option 2'],
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should reject duplicate options', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.select, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'select',
        options: ['Option 1', 'Option 1'],
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Single File Schema Tests
  // -------------------------------------------------------------------------
  describe('Single File Schema', () => {
    it('should validate allowedFileUploadMethods', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.singleFile, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'file',
        allowedFileUploadMethods: ['local_file', 'remote_url'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image'],
        },
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should validate allowedTypesAndExtensions', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.singleFile, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'file',
        allowedFileUploadMethods: ['local_file'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['document', 'audio'],
          allowedFileExtensions: ['.pdf', '.mp3'],
        },
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Multi Files Schema Tests
  // -------------------------------------------------------------------------
  describe('Multi Files Schema', () => {
    it('should validate maxLength within file upload limit', () => {
      // Arrange
      const maxFileUploadLimit = 10
      const schema = createInputFieldSchema(PipelineInputVarType.multiFiles, mockT, { maxFileUploadLimit })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'file-list',
        allowedFileUploadMethods: ['local_file'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image'],
        },
        maxLength: 5,
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should reject maxLength exceeding file upload limit', () => {
      // Arrange
      const maxFileUploadLimit = 10
      const schema = createInputFieldSchema(PipelineInputVarType.multiFiles, mockT, { maxFileUploadLimit })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'file-list',
        allowedFileUploadMethods: ['local_file'],
        allowedTypesAndExtensions: {
          allowedFileTypes: ['image'],
        },
        maxLength: 15,
      }

      // Act
      const result = schema.safeParse(invalidData)

      // Assert
      expect(result.success).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Default Schema Tests (for checkbox and other types)
  // -------------------------------------------------------------------------
  describe('Default Schema', () => {
    it('should validate checkbox type with common schema', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.checkbox, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'checkbox',
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
    })

    it('should allow passthrough of additional fields', () => {
      // Arrange
      const schema = createInputFieldSchema(PipelineInputVarType.checkbox, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'checkbox',
        extraField: 'extra value',
      }

      // Act
      const result = schema.safeParse(validData)

      // Assert
      expect(result.success).toBe(true)
      if (result.success) {
        expect((result.data as Record<string, unknown>).extraField).toBe('extra value')
      }
    })
  })
})

// ============================================================================
// Types Tests
// ============================================================================

describe('Types', () => {
  describe('FormData type', () => {
    it('should have correct structure', () => {
      // This is a compile-time check, but we can verify at runtime too
      const formData: FormData = {
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test',
        required: true,
        allowedTypesAndExtensions: {
          allowedFileTypes: [],
          allowedFileExtensions: [],
        },
      }

      expect(formData.type).toBeDefined()
      expect(formData.label).toBeDefined()
      expect(formData.variable).toBeDefined()
      expect(formData.required).toBeDefined()
    })

    it('should allow optional fields', () => {
      const formData: FormData = {
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test',
        required: true,
        maxLength: 100,
        default: 'default',
        tooltips: 'tooltip',
        options: ['a', 'b'],
        placeholder: 'placeholder',
        unit: 'unit',
        allowedFileUploadMethods: [],
        allowedTypesAndExtensions: {
          allowedFileTypes: [],
          allowedFileExtensions: [],
        },
      }

      expect(formData.maxLength).toBe(100)
      expect(formData.default).toBe('default')
      expect(formData.tooltips).toBe('tooltip')
    })
  })

  describe('InputFieldFormProps type', () => {
    it('should have correct required props', () => {
      const props: InputFieldFormProps = {
        initialData: {},
        onCancel: vi.fn(),
        onSubmit: vi.fn(),
      }

      expect(props.initialData).toBeDefined()
      expect(props.onCancel).toBeDefined()
      expect(props.onSubmit).toBeDefined()
    })

    it('should have correct optional props with defaults', () => {
      const props: InputFieldFormProps = {
        initialData: {},
        onCancel: vi.fn(),
        onSubmit: vi.fn(),
        supportFile: true,
        isEditMode: false,
      }

      expect(props.supportFile).toBe(true)
      expect(props.isEditMode).toBe(false)
    })
  })
})

// ============================================================================
// TEXT_MAX_LENGTH Constant Tests
// ============================================================================

describe('TEXT_MAX_LENGTH', () => {
  it('should be a positive number', () => {
    expect(TEXT_MAX_LENGTH).toBeGreaterThan(0)
  })

  it('should be 256', () => {
    expect(TEXT_MAX_LENGTH).toBe(256)
  })
})

// ============================================================================
// InitialFields Component Tests
// ============================================================================

describe('InitialFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render InitialFields component without crashing', () => {
      // Arrange
      const initialData = createFormData()
      const props = createInputFieldFormProps({ initialData })

      // Act
      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      // Assert
      expect(container.querySelector('form')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // getFieldValue and setFieldValue Callbacks Tests
  // -------------------------------------------------------------------------
  describe('getFieldValue and setFieldValue Callbacks', () => {
    it('should trigger getFieldValue when variable name blur event fires with empty label', async () => {
      // Arrange - Create initial data with empty label
      const initialData = createFormData({
        variable: '',
        label: '', // Empty label to trigger the condition
      })
      const props = createInputFieldFormProps({ initialData })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Find the variable input and trigger blur with a value
      const variableInput = screen.getByLabelText('appDebug.variableConfig.varName')
      fireEvent.change(variableInput, { target: { value: 'test_var' } })
      fireEvent.blur(variableInput)

      // Assert - The label field should be updated via setFieldValue when variable blurs
      // The getFieldValue is called to check if label is empty
      await waitFor(() => {
        const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
        // Label should be set to the variable value when it was empty
        expect(labelInput).toHaveValue('test_var')
      })
    })

    it('should not update label when it already has a value on variable blur', async () => {
      // Arrange - Create initial data with existing label
      const initialData = createFormData({
        variable: '',
        label: 'Existing Label', // Label already has value
      })
      const props = createInputFieldFormProps({ initialData })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Find the variable input and trigger blur with a value
      const variableInput = screen.getByLabelText('appDebug.variableConfig.varName')
      fireEvent.change(variableInput, { target: { value: 'new_var' } })
      fireEvent.blur(variableInput)

      // Assert - The label field should remain unchanged because it already has a value
      await waitFor(() => {
        const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
        expect(labelInput).toHaveValue('Existing Label')
      })
    })

    it('should trigger setFieldValue when display name blur event fires with empty value', async () => {
      // Arrange - Create initial data with a variable but we will clear the label
      const initialData = createFormData({
        variable: 'original_var',
        label: 'Some Label',
      })
      const props = createInputFieldFormProps({ initialData })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Find the label input, clear it, and trigger blur
      const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
      fireEvent.change(labelInput, { target: { value: '' } })
      fireEvent.blur(labelInput)

      // Assert - When label is cleared and blurred, it should be reset to variable name
      await waitFor(() => {
        expect(labelInput).toHaveValue('original_var')
      })
    })

    it('should keep label value when display name blur event fires with non-empty value', async () => {
      // Arrange
      const initialData = createFormData({
        variable: 'test_var',
        label: 'Original Label',
      })
      const props = createInputFieldFormProps({ initialData })

      // Act
      renderWithProviders(<InputFieldForm {...props} />)

      // Find the label input, change it to a new value, and trigger blur
      const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
      fireEvent.change(labelInput, { target: { value: 'New Label' } })
      fireEvent.blur(labelInput)

      // Assert - Label should keep the new non-empty value
      await waitFor(() => {
        expect(labelInput).toHaveValue('New Label')
      })
    })
  })
})
