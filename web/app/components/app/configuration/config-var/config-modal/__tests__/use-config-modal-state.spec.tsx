import type { ReactNode } from 'react'
import type { InputVar } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import DebugConfigurationContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import { useConfigModalState } from '../use-config-modal-state'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

type DebugConfigValue = React.ComponentProps<typeof DebugConfigurationContext.Provider>['value']

const createDebugConfigValue = (overrides: Partial<DebugConfigValue> = {}): DebugConfigValue => ({
  mode: AppModeEnum.CHAT,
  modelConfig: {
    model_id: 'test-model',
  },
  ...overrides,
} as DebugConfigValue)

const createAppDetail = (mode: AppModeEnum) => ({
  mode,
}) as NonNullable<ReturnType<typeof useAppStore.getState>['appDetail']>

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: 'Name',
  variable: 'name',
  required: false,
  hide: false,
  default: '',
  ...overrides,
})

const renderConfigModalHook = (
  props: Partial<Parameters<typeof useConfigModalState>[0]> = {},
  debugOverrides: Partial<DebugConfigValue> = {},
) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DebugConfigurationContext.Provider value={createDebugConfigValue(debugOverrides)}>
      {children}
    </DebugConfigurationContext.Provider>
  )

  return renderHook(() => useConfigModalState({
    isShow: true,
    onConfirm: vi.fn(),
    payload: createInputVar(),
    supportFile: false,
    ...props,
  }), { wrapper })
}

describe('useConfigModalState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ appDetail: createAppDetail(AppModeEnum.CHAT) })
  })

  // Covers app-mode dependent type options.
  describe('select options', () => {
    it('should expose JSON and file types for advanced apps with file support', () => {
      useAppStore.setState({ appDetail: createAppDetail(AppModeEnum.WORKFLOW) })
      const { result } = renderConfigModalHook({
        supportFile: true,
      })

      const optionValues = result.current.selectOptions.map(option => option.value)
      expect(optionValues).toContain(InputVarType.singleFile)
      expect(optionValues).toContain(InputVarType.multiFiles)
      expect(optionValues).toContain(InputVarType.jsonObject)
    })
  })

  // Covers variable input normalization and label auto-fill.
  describe('variable editing', () => {
    it('should replace spaces with underscores and copy the value into label on blur', () => {
      const { result } = renderConfigModalHook({
        payload: createInputVar({
          label: '',
          variable: '',
        }),
      })

      const input = document.createElement('input')
      input.value = 'user name'
      input.setSelectionRange(0, 0)

      act(() => {
        result.current.handleVarNameChange({ target: input } as React.ChangeEvent<HTMLInputElement>)
      })

      expect(input.value).toBe('user_name')
      expect(result.current.tempPayload.variable).toBe('user_name')

      act(() => {
        result.current.handleVarKeyBlur({ target: input } as React.FocusEvent<HTMLInputElement>)
      })

      expect(result.current.tempPayload.label).toBe('user_name')
    })

    it('should reject invalid variable names and avoid overwriting an existing label on blur', () => {
      const { result } = renderConfigModalHook({
        payload: createInputVar({
          label: 'Existing label',
          variable: 'name',
        }),
      })

      const invalidInput = document.createElement('input')
      invalidInput.value = '1bad'

      act(() => {
        result.current.handleVarNameChange({ target: invalidInput } as React.ChangeEvent<HTMLInputElement>)
      })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('appDebug.varKeyError.notStartWithNumber'))
      expect(result.current.tempPayload.variable).toBe('name')

      const blurInput = document.createElement('input')
      blurInput.value = 'updated_name'

      act(() => {
        result.current.handleVarKeyBlur({ target: blurInput } as React.FocusEvent<HTMLInputElement>)
      })

      expect(result.current.tempPayload.label).toBe('Existing label')
    })
  })

  // Covers payload mutation helpers and schema parsing.
  describe('state helpers', () => {
    it('should clear invalid select defaults and normalize json schema edits', () => {
      const { result } = renderConfigModalHook({
        payload: createInputVar({
          type: InputVarType.select,
          default: 'keep-me',
          options: ['keep-me', 'next'],
        }),
      })

      act(() => {
        result.current.handlePayloadChange('options')(['next'])
      })

      expect(result.current.tempPayload.options).toEqual(['next'])
      expect(result.current.tempPayload.default).toBeUndefined()

      act(() => {
        result.current.handleJSONSchemaChange('{"type":"object"}')
      })

      expect(result.current.tempPayload.json_schema).toBe('{\n  "type": "object"\n}')

      act(() => {
        result.current.handleJSONSchemaChange('   ')
      })

      expect(result.current.tempPayload.json_schema).toBeUndefined()
      expect(result.current.handleJSONSchemaChange('{invalid')).toBeNull()
    })

    it('should update the payload when changing types and expose file/json options for advanced apps', () => {
      useAppStore.setState({ appDetail: createAppDetail(AppModeEnum.WORKFLOW) })
      const { result } = renderConfigModalHook({
        supportFile: true,
      })

      act(() => {
        result.current.handleTypeChange({ value: InputVarType.singleFile, name: 'Single File' })
      })

      expect(result.current.tempPayload.type).toBe(InputVarType.singleFile)
      expect(result.current.selectOptions.map(option => option.value)).toEqual(expect.arrayContaining([
        InputVarType.singleFile,
        InputVarType.multiFiles,
        InputVarType.jsonObject,
      ]))
    })
  })

  // Covers confirm validation and metadata generation.
  describe('confirm flows', () => {
    it('should block duplicate select options and show an error toast', () => {
      const onConfirm = vi.fn()
      const { result } = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.select,
          options: ['first', 'first'],
        }),
      })

      act(() => {
        result.current.handleConfirm()
      })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.optionRepeat')
    })

    it('should block missing labels, invalid variable names, and incomplete file settings', () => {
      const onConfirm = vi.fn()
      const { result, rerender } = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          variable: '1bad',
          label: 'Valid label',
        }),
      })

      act(() => {
        result.current.handleConfirm()
      })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('appDebug.varKeyError.notStartWithNumber'))

      rerender()

      const labelless = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          label: '',
        }),
      })

      act(() => {
        labelless.result.current.handleConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.labelNameRequired')

      const noFileTypes = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.singleFile,
          label: 'File input',
          default: undefined,
          allowed_file_types: [],
        }),
      })

      act(() => {
        noFileTypes.result.current.handleConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('workflow.errorMsg.fieldRequired'))

      const customWithoutExtensions = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.singleFile,
          label: 'File input',
          default: undefined,
          allowed_file_types: [SupportUploadFileTypes.custom],
          allowed_file_extensions: [],
        }),
      })

      act(() => {
        customWithoutExtensions.result.current.handleConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('workflow.errorMsg.fieldRequired'))
    })

    it('should validate select and json object edge cases before saving', () => {
      const onConfirm = vi.fn()
      const emptyOptions = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.select,
          options: [],
        }),
      })

      act(() => {
        emptyOptions.result.current.handleConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.atLeastOneOption')

      const invalidJson = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.jsonObject,
          label: 'JSON payload',
          json_schema: '{invalid}',
        }),
      })

      act(() => {
        invalidJson.result.current.handleConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.jsonSchemaInvalid')

      const nonObjectJson = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.jsonObject,
          label: 'JSON payload',
          json_schema: '{"type":"array"}',
        }),
      })

      act(() => {
        nonObjectJson.result.current.handleConfirm()
      })

      expect(toast.error).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.jsonSchemaMustBeObject')
    })

    it('should omit empty JSON schema and include rename metadata when saving', () => {
      const onConfirm = vi.fn()
      const { result } = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          type: InputVarType.jsonObject,
          json_schema: '   ',
          variable: 'old_name',
          label: 'JSON payload',
        }),
      })

      act(() => {
        result.current.handlePayloadChange('variable')('new_name')
      })

      act(() => {
        result.current.handleConfirm()
      })

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        variable: 'new_name',
        json_schema: undefined,
      }), {
        type: 'changeVarName',
        payload: {
          beforeKey: 'old_name',
          afterKey: 'new_name',
        },
      })
    })

    it('should save without rename metadata when the variable name does not change', () => {
      const onConfirm = vi.fn()
      const { result } = renderConfigModalHook({
        onConfirm,
        payload: createInputVar({
          variable: 'same_name',
          label: 'Same name',
        }),
      })

      act(() => {
        result.current.handleConfirm()
      })

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        variable: 'same_name',
      }), undefined)
    })
  })
})
