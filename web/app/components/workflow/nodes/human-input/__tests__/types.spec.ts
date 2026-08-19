import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import {
  createDefaultFormInputByType,
  createDefaultParagraphFormInput,
  isFileFormInput,
  isFileListFormInput,
  isParagraphFormInput,
  isSelectFormInput,
} from '../types'

describe('human-input/types', () => {
  describe('type guards', () => {
    it('should identify each form input kind', () => {
      const paragraph = createDefaultFormInputByType(InputVarType.paragraph, 'comment')
      const select = createDefaultFormInputByType(InputVarType.select, 'decision')
      const singleFile = createDefaultFormInputByType(InputVarType.singleFile, 'attachment')
      const multiFiles = createDefaultFormInputByType(InputVarType.multiFiles, 'attachments')

      expect(isParagraphFormInput(paragraph)).toBe(true)
      expect(isParagraphFormInput(select)).toBe(false)
      expect(isSelectFormInput(select)).toBe(true)
      expect(isSelectFormInput(singleFile)).toBe(false)
      expect(isFileFormInput(singleFile)).toBe(true)
      expect(isFileFormInput(multiFiles)).toBe(false)
      expect(isFileListFormInput(multiFiles)).toBe(true)
      expect(isFileListFormInput(paragraph)).toBe(false)
    })
  })

  describe('default factories', () => {
    it('should create a paragraph input with an empty constant default', () => {
      expect(createDefaultParagraphFormInput('review')).toEqual({
        type: InputVarType.paragraph,
        output_variable_name: 'review',
        default: {
          type: 'constant',
          selector: [],
          value: '',
        },
      })
    })

    it('should create defaults for every supported input type', () => {
      expect(createDefaultFormInputByType(InputVarType.select, 'choice')).toEqual({
        type: InputVarType.select,
        output_variable_name: 'choice',
        option_source: {
          type: 'constant',
          selector: [],
          value: [],
        },
      })

      expect(createDefaultFormInputByType(InputVarType.singleFile, 'file')).toEqual({
        type: InputVarType.singleFile,
        output_variable_name: 'file',
        allowed_file_extensions: [],
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      })

      expect(createDefaultFormInputByType(InputVarType.multiFiles, 'files')).toEqual({
        type: InputVarType.multiFiles,
        output_variable_name: 'files',
        allowed_file_extensions: [],
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        number_limits: 5,
      })
    })
  })
})
