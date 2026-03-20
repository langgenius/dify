import type { FormData, InputFieldFormProps } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import Toast from '@/app/components/base/toast'
import { PipelineInputVarType } from '@/models/pipeline'
import { useConfigurations, useHiddenConfigurations, useHiddenFieldNames } from '../hooks'
import InputFieldForm from '../index'
import { createInputFieldSchema, TEXT_MAX_LENGTH } from '../schema'

const createMockEvent = <T,>(value: T) => ({ value }) as unknown as Parameters<NonNullable<NonNullable<ReturnType<typeof useConfigurations>[number]['listeners']>['onChange']>>[0]

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

// Silence expected console.error from form submit preventDefault
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
})

describe('InputFieldForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render form without crashing', () => {
      const props = createInputFieldFormProps()

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      const props = createInputFieldFormProps()

      renderWithProviders(<InputFieldForm {...props} />)

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should render form with initial values', () => {
      const initialData = createFormData({
        variable: 'custom_var',
        label: 'Custom Label',
      })
      const props = createInputFieldFormProps({ initialData })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should handle supportFile=true prop', () => {
      const props = createInputFieldFormProps({ supportFile: true })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle supportFile=false (default) prop', () => {
      const props = createInputFieldFormProps({ supportFile: false })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle isEditMode=true prop', () => {
      const props = createInputFieldFormProps({ isEditMode: true })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle isEditMode=false prop', () => {
      const props = createInputFieldFormProps({ isEditMode: false })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should handle different initial data types', () => {
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

        const { container, unmount } = renderWithProviders(<InputFieldForm {...props} />)

        expect(container.querySelector('form')).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const onCancel = vi.fn()
      const props = createInputFieldFormProps({ onCancel })

      renderWithProviders(<InputFieldForm {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should prevent default on form submit', async () => {
      const props = createInputFieldFormProps()
      const { container } = renderWithProviders(<InputFieldForm {...props} />)
      const form = container.querySelector('form')!
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true })

      form.dispatchEvent(submitEvent)

      expect(submitEvent.defaultPrevented).toBe(true)
    })

    it('should show Toast error when form validation fails on submit', async () => {
      const initialData = createFormData({
        variable: '', // Empty variable should fail validation
        label: 'Test Label',
      })
      const onSubmit = vi.fn()
      const props = createInputFieldFormProps({ initialData, onSubmit })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)
      const form = container.querySelector('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'error',
            message: expect.any(String),
          }),
        )
      })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should call onSubmit with moreInfo when variable name changes in edit mode', async () => {
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

      renderWithProviders(<InputFieldForm {...props} />)

      const variableInput = screen.getByLabelText('appDebug.variableConfig.varName')
      fireEvent.change(variableInput, { target: { value: 'new_var' } })

      const form = document.querySelector('form')!
      fireEvent.submit(form)

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

      renderWithProviders(<InputFieldForm {...props} />)

      const form = document.querySelector('form')!
      fireEvent.submit(form)

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

      renderWithProviders(<InputFieldForm {...props} />)

      const form = document.querySelector('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.any(Object),
          undefined,
        )
      })
    })
  })

  describe('State Management', () => {
    it('should initialize showAllSettings state as false', () => {
      const props = createInputFieldFormProps()

      renderWithProviders(<InputFieldForm {...props} />)

      expect(screen.queryByText(/appDebug.variableConfig.showAllSettings/i)).toBeInTheDocument()
    })

    it('should toggle showAllSettings state when clicking show all settings', async () => {
      const props = createInputFieldFormProps()
      renderWithProviders(<InputFieldForm {...props} />)

      const showAllSettingsElement = screen.getByText(/appDebug.variableConfig.showAllSettings/i)
      const clickableParent = showAllSettingsElement.closest('.cursor-pointer')
      if (clickableParent) {
        fireEvent.click(clickableParent)
      }

      await waitFor(() => {
        expect(screen.queryByText(/appDebug.variableConfig.showAllSettings/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable onCancel callback reference', () => {
      const onCancel = vi.fn()
      const props = createInputFieldFormProps({ onCancel })

      renderWithProviders(<InputFieldForm {...props} />)
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)
      fireEvent.click(cancelButton)

      expect(onCancel).toHaveBeenCalledTimes(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty initial data gracefully', () => {
      const props = createInputFieldFormProps({
        initialData: {} as Record<string, unknown>,
      })

      expect(() => renderWithProviders(<InputFieldForm {...props} />)).not.toThrow()
    })

    it('should handle undefined optional fields', () => {
      const initialData = {
        type: PipelineInputVarType.textInput,
        label: 'Test',
        variable: 'test',
        required: true,
        allowedTypesAndExtensions: {
          allowedFileTypes: [],
          allowedFileExtensions: [],
        },
      }
      const props = createInputFieldFormProps({ initialData })

      expect(() => renderWithProviders(<InputFieldForm {...props} />)).not.toThrow()
    })

    it('should handle special characters in variable name', () => {
      const initialData = createFormData({
        variable: 'test_var_123',
        label: 'Test Label <script>',
      })
      const props = createInputFieldFormProps({ initialData })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })
  })
})

describe('useHiddenFieldNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Return Values by Type', () => {
    it('should return correct field names for textInput type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.textInput),
      )

      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.placeholder'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for paragraph type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.paragraph),
      )

      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.placeholder'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for number type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.number),
      )

      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.unit'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.placeholder'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for select type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.select),
      )

      expect(result.current).toContain('appDebug.variableConfig.defaultValue'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for singleFile type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.singleFile),
      )

      expect(result.current).toContain('appDebug.variableConfig.uploadMethod'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for multiFiles type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.multiFiles),
      )

      expect(result.current).toContain('appDebug.variableConfig.uploadMethod'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.maxNumberOfUploads'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })

    it('should return correct field names for checkbox type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames(PipelineInputVarType.checkbox),
      )

      expect(result.current).toContain('appDebug.variableConfig.startChecked'.toLowerCase())
      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })
  })

  describe('Edge Cases', () => {
    it('should return tooltips only for unknown type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenFieldNames('unknown_type' as PipelineInputVarType),
      )

      expect(result.current).toContain('appDebug.variableConfig.tooltips'.toLowerCase())
    })
  })
})

describe('useConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Configuration Generation', () => {
    it('should return array of configurations', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      expect(Array.isArray(result.current)).toBe(true)
      expect(result.current.length).toBeGreaterThan(0)
    })

    it('should include type field configuration', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const typeConfig = result.current.find(config => config.variable === 'type')
      expect(typeConfig).toBeDefined()
      expect(typeConfig?.required).toBe(true)
    })

    it('should include variable field configuration', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const variableConfig = result.current.find(config => config.variable === 'variable')
      expect(variableConfig).toBeDefined()
      expect(variableConfig?.required).toBe(true)
    })

    it('should include label field configuration', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const labelConfig = result.current.find(config => config.variable === 'label')
      expect(labelConfig).toBeDefined()
      expect(labelConfig?.required).toBe(false)
    })

    it('should include required field configuration', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const requiredConfig = result.current.find(config => config.variable === 'required')
      expect(requiredConfig).toBeDefined()
    })

    it('should pass supportFile prop to type configuration', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: true,
        }),
      )

      const typeConfig = result.current.find(config => config.variable === 'type')
      expect(typeConfig?.supportFile).toBe(true)
    })
  })

  describe('Callbacks', () => {
    it('should call setFieldValue when type changes to singleFile', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: true,
        }),
      )

      const typeConfig = result.current.find(config => config.variable === 'type')
      typeConfig?.listeners?.onChange?.(createMockEvent(PipelineInputVarType.singleFile))

      expect(mockSetFieldValue).toHaveBeenCalledWith('allowedFileUploadMethods', expect.any(Array))
      expect(mockSetFieldValue).toHaveBeenCalledWith('allowedTypesAndExtensions', expect.any(Object))
    })

    it('should call setFieldValue when type changes to multiFiles', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: true,
        }),
      )

      const typeConfig = result.current.find(config => config.variable === 'type')
      typeConfig?.listeners?.onChange?.(createMockEvent(PipelineInputVarType.multiFiles))

      expect(mockSetFieldValue).toHaveBeenCalledWith('maxLength', expect.any(Number))
    })

    it('should set label from variable name on blur when label is empty', () => {
      const mockGetFieldValue = vi.fn().mockReturnValue('')
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const variableConfig = result.current.find(config => config.variable === 'variable')
      variableConfig?.listeners?.onBlur?.(createMockEvent('test_variable'))

      expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'test_variable')
    })

    it('should not set label from variable name on blur when label is not empty', () => {
      const mockGetFieldValue = vi.fn().mockReturnValue('Existing Label')
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const variableConfig = result.current.find(config => config.variable === 'variable')
      variableConfig?.listeners?.onBlur?.(createMockEvent('test_variable'))

      expect(mockSetFieldValue).not.toHaveBeenCalled()
    })

    it('should reset label to variable name when display name is cleared', () => {
      const mockGetFieldValue = vi.fn().mockReturnValue('original_var')
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      const labelConfig = result.current.find(config => config.variable === 'label')
      labelConfig?.listeners?.onBlur?.(createMockEvent(''))

      expect(mockSetFieldValue).toHaveBeenCalledWith('label', 'original_var')
    })
  })

  describe('Memoization', () => {
    it('should return configurations array with correct length', () => {
      const mockGetFieldValue = vi.fn()
      const mockSetFieldValue = vi.fn()

      const { result } = renderHookWithProviders(() =>
        useConfigurations({
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          supportFile: false,
        }),
      )

      expect(result.current.length).toBe(8) // type, variable, label, maxLength, options, fileTypes x2, required
    })
  })
})

describe('useHiddenConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Configuration Generation', () => {
    it('should return array of hidden configurations', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      expect(Array.isArray(result.current)).toBe(true)
      expect(result.current.length).toBeGreaterThan(0)
    })

    it('should include default value configurations for different types', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const defaultConfigs = result.current.filter(config => config.variable === 'default')
      expect(defaultConfigs.length).toBeGreaterThan(0)
    })

    it('should include tooltips configuration', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const tooltipsConfig = result.current.find(config => config.variable === 'tooltips')
      expect(tooltipsConfig).toBeDefined()
      expect(tooltipsConfig?.showConditions).toEqual([])
    })

    it('should include placeholder configurations', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const placeholderConfigs = result.current.filter(config => config.variable === 'placeholder')
      expect(placeholderConfigs.length).toBeGreaterThan(0)
    })

    it('should include unit configuration for number type', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const unitConfig = result.current.find(config => config.variable === 'unit')
      expect(unitConfig).toBeDefined()
      expect(unitConfig?.showConditions).toContainEqual({
        variable: 'type',
        value: PipelineInputVarType.number,
      })
    })

    it('should include upload method configurations for file types', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const uploadMethodConfigs = result.current.filter(
        config => config.variable === 'allowedFileUploadMethods',
      )
      expect(uploadMethodConfigs.length).toBe(2) // One for singleFile, one for multiFiles
    })

    it('should include maxLength configuration for multiFiles', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const maxLengthConfig = result.current.find(
        config => config.variable === 'maxLength'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.multiFiles),
      )
      expect(maxLengthConfig).toBeDefined()
    })
  })

  describe('Options Handling', () => {
    it('should generate select options from provided options array', () => {
      const options = ['Option A', 'Option B', 'Option C']

      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options }),
      )

      const selectConfig = result.current.find(
        config => config.variable === 'default'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.select),
      )
      expect(selectConfig?.options).toBeDefined()
      expect(selectConfig?.options?.length).toBe(4) // 3 options + 1 "no default" option
    })

    it('should include "no default selected" option', () => {
      const options = ['Option A']

      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options }),
      )

      const selectConfig = result.current.find(
        config => config.variable === 'default'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.select),
      )
      const noDefaultOption = selectConfig?.options?.find(opt => opt.value === '')
      expect(noDefaultOption).toBeDefined()
    })

    it('should return empty options when options is undefined', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const selectConfig = result.current.find(
        config => config.variable === 'default'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.select),
      )
      expect(selectConfig?.options).toEqual([])
    })
  })

  describe('File Size Limit Integration', () => {
    it('should include file size description in maxLength config', () => {
      const { result } = renderHookWithProviders(() =>
        useHiddenConfigurations({ options: undefined }),
      )

      const maxLengthConfig = result.current.find(
        config => config.variable === 'maxLength'
          && config.showConditions?.some(c => c.value === PipelineInputVarType.multiFiles),
      )
      expect(maxLengthConfig?.description).toBeDefined()
    })
  })
})

describe('createInputFieldSchema', () => {
  const mockT = ((key: string) => key) as unknown as Parameters<typeof createInputFieldSchema>[1]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Common Schema Validation', () => {
    it('should validate required variable field', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = { variable: '', label: 'Test', required: true, type: 'text-input' }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should validate variable max length', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'a'.repeat(100),
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should validate variable does not start with number', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: '123var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should validate variable format (alphanumeric and underscore)', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'var-name',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should accept valid variable name', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'valid_var_123',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should validate required label field', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: '',
        required: true,
        type: 'text-input',
        maxLength: 48,
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })
  })

  describe('Text Input Schema', () => {
    it('should validate maxLength within bounds', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 100,
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should reject maxLength exceeding TEXT_MAX_LENGTH', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: TEXT_MAX_LENGTH + 1,
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should reject maxLength less than 1', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 0,
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should allow optional default value', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.textInput, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'text-input',
        maxLength: 48,
        default: 'default value',
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })
  })

  describe('Paragraph Schema', () => {
    it('should validate paragraph type similar to textInput', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.paragraph, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'paragraph',
        maxLength: 100,
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })
  })

  describe('Number Schema', () => {
    it('should allow optional default number', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.number, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'number',
        default: 42,
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should allow optional unit', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.number, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'number',
        unit: 'kg',
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })
  })

  describe('Select Schema', () => {
    it('should require non-empty options array', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.select, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'select',
        options: [],
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })

    it('should accept valid options array', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.select, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'select',
        options: ['Option 1', 'Option 2'],
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should reject duplicate options', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.select, mockT, { maxFileUploadLimit: 10 })
      const invalidData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'select',
        options: ['Option 1', 'Option 1'],
      }

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })
  })

  describe('Single File Schema', () => {
    it('should validate allowedFileUploadMethods', () => {
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

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should validate allowedTypesAndExtensions', () => {
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

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })
  })

  describe('Multi Files Schema', () => {
    it('should validate maxLength within file upload limit', () => {
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

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should reject maxLength exceeding file upload limit', () => {
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

      const result = schema.safeParse(invalidData)

      expect(result.success).toBe(false)
    })
  })

  describe('Default Schema', () => {
    it('should validate checkbox type with common schema', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.checkbox, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'checkbox',
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
    })

    it('should allow passthrough of additional fields', () => {
      const schema = createInputFieldSchema(PipelineInputVarType.checkbox, mockT, { maxFileUploadLimit: 10 })
      const validData = {
        variable: 'test_var',
        label: 'Test',
        required: true,
        type: 'checkbox',
        extraField: 'extra value',
      }

      const result = schema.safeParse(validData)

      expect(result.success).toBe(true)
      if (result.success) {
        expect((result.data as Record<string, unknown>).extraField).toBe('extra value')
      }
    })
  })
})

describe('Types', () => {
  describe('FormData type', () => {
    it('should have correct structure', () => {
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

describe('TEXT_MAX_LENGTH', () => {
  it('should be a positive number', () => {
    expect(TEXT_MAX_LENGTH).toBeGreaterThan(0)
  })

  it('should be 256', () => {
    expect(TEXT_MAX_LENGTH).toBe(256)
  })
})

describe('InitialFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render InitialFields component without crashing', () => {
      const initialData = createFormData()
      const props = createInputFieldFormProps({ initialData })

      const { container } = renderWithProviders(<InputFieldForm {...props} />)

      expect(container.querySelector('form')).toBeInTheDocument()
    })
  })

  describe('getFieldValue and setFieldValue Callbacks', () => {
    it('should trigger getFieldValue when variable name blur event fires with empty label', async () => {
      const initialData = createFormData({
        variable: '',
        label: '', // Empty label to trigger the condition
      })
      const props = createInputFieldFormProps({ initialData })

      renderWithProviders(<InputFieldForm {...props} />)

      const variableInput = screen.getByLabelText('appDebug.variableConfig.varName')
      fireEvent.change(variableInput, { target: { value: 'test_var' } })
      fireEvent.blur(variableInput)

      await waitFor(() => {
        const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
        expect(labelInput).toHaveValue('test_var')
      })
    })

    it('should not update label when it already has a value on variable blur', async () => {
      const initialData = createFormData({
        variable: '',
        label: 'Existing Label', // Label already has value
      })
      const props = createInputFieldFormProps({ initialData })

      renderWithProviders(<InputFieldForm {...props} />)

      const variableInput = screen.getByLabelText('appDebug.variableConfig.varName')
      fireEvent.change(variableInput, { target: { value: 'new_var' } })
      fireEvent.blur(variableInput)

      await waitFor(() => {
        const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
        expect(labelInput).toHaveValue('Existing Label')
      })
    })

    it('should trigger setFieldValue when display name blur event fires with empty value', async () => {
      const initialData = createFormData({
        variable: 'original_var',
        label: 'Some Label',
      })
      const props = createInputFieldFormProps({ initialData })

      renderWithProviders(<InputFieldForm {...props} />)

      const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
      fireEvent.change(labelInput, { target: { value: '' } })
      fireEvent.blur(labelInput)

      await waitFor(() => {
        expect(labelInput).toHaveValue('original_var')
      })
    })

    it('should keep label value when display name blur event fires with non-empty value', async () => {
      const initialData = createFormData({
        variable: 'test_var',
        label: 'Original Label',
      })
      const props = createInputFieldFormProps({ initialData })

      renderWithProviders(<InputFieldForm {...props} />)

      const labelInput = screen.getByLabelText('appDebug.variableConfig.displayName')
      fireEvent.change(labelInput, { target: { value: 'New Label' } })
      fireEvent.blur(labelInput)

      await waitFor(() => {
        expect(labelInput).toHaveValue('New Label')
      })
    })
  })
})
