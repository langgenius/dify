import type { InputVar } from '@/app/components/workflow/types'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import {
  buildSelectOptions,
  createPayloadForType,
  getCheckboxDefaultSelectValue,
  isJsonSchemaEmpty,
  normalizeSelectDefaultValue,
  updatePayloadField,
  validateConfigModalPayload,
} from '../utils'

const t = (key: string) => key

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: 'Question',
  variable: 'question',
  required: false,
  options: [],
  hide: false,
  ...overrides,
})

describe('config-modal utils', () => {
  describe('payload helpers', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should clear the default value when options no longer include it', () => {
      const payload = createInputVar({
        type: InputVarType.select,
        default: 'beta',
        options: ['alpha', 'beta'],
      })

      const nextPayload = updatePayloadField(payload, 'options', ['alpha'])

      expect(nextPayload.default).toBeUndefined()
      expect(nextPayload.options).toEqual(['alpha'])
    })

    it('should seed upload defaults when switching to multi-file input', () => {
      const payload = createInputVar({
        type: InputVarType.textInput,
        default: 'hello',
      })

      const nextPayload = createPayloadForType(payload, InputVarType.multiFiles)

      expect(nextPayload.type).toBe(InputVarType.multiFiles)
      expect(nextPayload.max_length).toBe(DEFAULT_FILE_UPLOAD_SETTING.max_length)
      expect(nextPayload.allowed_file_types).toEqual(DEFAULT_FILE_UPLOAD_SETTING.allowed_file_types)
      expect(nextPayload.default).toBe('hello')
    })

    it('should normalize empty select defaults to undefined', () => {
      const nextPayload = normalizeSelectDefaultValue(createInputVar({
        type: InputVarType.select,
        default: '',
      }))

      expect(nextPayload.default).toBeUndefined()
    })
  })

  describe('derived values', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should expose upload and json options only when supported', () => {
      const options = buildSelectOptions({
        isBasicApp: false,
        supportFile: true,
        t,
      })

      expect(options.map(option => option.value)).toEqual(expect.arrayContaining([
        InputVarType.singleFile,
        InputVarType.multiFiles,
        InputVarType.jsonObject,
      ]))
    })

    it('should derive checkbox defaults from boolean and string values', () => {
      expect(getCheckboxDefaultSelectValue(true)).toBe('true')
      expect(getCheckboxDefaultSelectValue('TRUE')).toBe('true')
      expect(getCheckboxDefaultSelectValue(undefined)).toBe('false')
    })

    it('should detect blank json schema values', () => {
      expect(isJsonSchemaEmpty(undefined)).toBe(true)
      expect(isJsonSchemaEmpty('   ')).toBe(true)
      expect(isJsonSchemaEmpty('{}')).toBe(false)
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should reject duplicate select options', () => {
      const checkVariableName = vi.fn(() => true)

      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.select,
          options: ['alpha', 'alpha'],
        }),
        checkVariableName,
        payload: createInputVar({
          variable: 'question',
        }),
        t,
      })

      expect(result.errorMessage).toBe('variableConfig.errorMsg.optionRepeat')
      expect(checkVariableName).toHaveBeenCalledWith('question')
    })

    it('should require custom extensions when custom file types are enabled', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.singleFile,
          allowed_file_types: [SupportUploadFileTypes.custom],
          allowed_file_extensions: [],
        }),
        checkVariableName: () => true,
        payload: createInputVar(),
        t,
      })

      expect(result.errorMessage).toBe('errorMsg.fieldRequired')
    })

    it('should normalize blank json schema and return rename metadata', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.jsonObject,
          variable: 'question_new',
          json_schema: '   ',
        }),
        payload: createInputVar({
          variable: 'question_old',
        }),
        checkVariableName: () => true,
        t,
      })

      expect(result.errorMessage).toBeUndefined()
      expect(result.payloadToSave).toEqual(expect.objectContaining({
        json_schema: undefined,
        variable: 'question_new',
      }))
      expect(result.moreInfo).toEqual({
        type: ChangeType.changeVarName,
        payload: {
          beforeKey: 'question_old',
          afterKey: 'question_new',
        },
      })
    })
  })
})
