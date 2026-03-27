import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import {
  applyTypeChange,
  CHECKBOX_DEFAULT_FALSE_VALUE,
  CHECKBOX_DEFAULT_TRUE_VALUE,
  getCheckboxDefaultSelectValue,
  isJsonSchemaEmpty,
  normalizeSelectDefaultValue,
  parseCheckboxSelectValue,
} from '../helpers'

const createInputVar = (overrides = {}) => ({
  type: InputVarType.textInput,
  label: 'Name',
  variable: 'name',
  required: false,
  hide: false,
  default: '',
  options: [],
  allowed_file_types: [SupportUploadFileTypes.document],
  allowed_file_extensions: ['pdf'],
  allowed_file_upload_methods: [TransferMethod.local_file],
  max_length: 1,
  ...overrides,
})

describe('config-modal helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers checkbox default parsing for primitive and string payload values.
  describe('checkbox defaults', () => {
    it('should normalize checkbox default values to selector options', () => {
      expect(getCheckboxDefaultSelectValue(true)).toBe(CHECKBOX_DEFAULT_TRUE_VALUE)
      expect(getCheckboxDefaultSelectValue('true')).toBe(CHECKBOX_DEFAULT_TRUE_VALUE)
      expect(getCheckboxDefaultSelectValue(false)).toBe(CHECKBOX_DEFAULT_FALSE_VALUE)
      expect(getCheckboxDefaultSelectValue(undefined)).toBe(CHECKBOX_DEFAULT_FALSE_VALUE)
    })

    it('should convert selector values back to boolean defaults', () => {
      expect(parseCheckboxSelectValue(CHECKBOX_DEFAULT_TRUE_VALUE)).toBe(true)
      expect(parseCheckboxSelectValue(CHECKBOX_DEFAULT_FALSE_VALUE)).toBe(false)
    })
  })

  // Covers select normalization and JSON schema blank detection.
  describe('normalization', () => {
    it('should clear empty select defaults but keep other defaults unchanged', () => {
      expect(normalizeSelectDefaultValue(createInputVar({
        type: InputVarType.select,
        default: '',
      }))).toEqual(expect.objectContaining({ default: undefined }))

      expect(normalizeSelectDefaultValue(createInputVar({
        type: InputVarType.textInput,
        default: '',
      }))).toEqual(expect.objectContaining({ default: '' }))
    })

    it('should detect empty JSON schema values', () => {
      expect(isJsonSchemaEmpty(undefined)).toBe(true)
      expect(isJsonSchemaEmpty('   ')).toBe(true)
      expect(isJsonSchemaEmpty('{}')).toBe(false)
      expect(isJsonSchemaEmpty({ type: 'object' })).toBe(false)
    })
  })

  // Covers type switching behavior for select and file input payloads.
  describe('type changes', () => {
    it('should reset select defaults when switching to select type', () => {
      const nextPayload = applyTypeChange(createInputVar({
        default: 'hello',
      }), InputVarType.select)

      expect(nextPayload.type).toBe(InputVarType.select)
      expect(nextPayload.default).toBeUndefined()
    })

    it('should seed upload defaults when switching to multi-file type', () => {
      const nextPayload = applyTypeChange(createInputVar({
        allowed_file_types: [],
        allowed_file_extensions: [],
        allowed_file_upload_methods: [],
        max_length: 1,
      }), InputVarType.multiFiles)

      expect(nextPayload).toEqual(expect.objectContaining({
        type: InputVarType.multiFiles,
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        max_length: 5,
      }))
    })
  })
})
