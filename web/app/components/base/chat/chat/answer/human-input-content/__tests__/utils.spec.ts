import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Locale } from '@/i18n-config/language'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import {
  getButtonStyle,
  getRelativeTime,
  initializeInputs,
  isRelativeTimeSameOrAfter,
  splitByOutputVar,
} from '../utils'

const paragraphInput = (overrides: Partial<Extract<FormInputItem, { type: InputVarType.paragraph }>> = {}): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'field',
  default: {
    type: 'constant',
    value: '',
    selector: [],
  },
  ...overrides,
})

const selectInput = (overrides: Partial<Extract<FormInputItem, { type: InputVarType.select }>> = {}): FormInputItem => ({
  type: InputVarType.select,
  output_variable_name: 'field',
  option_source: {
    type: 'constant',
    value: ['option-a', 'option-b'],
    selector: [],
  },
  ...overrides,
})

const fileInput = (overrides: Partial<Extract<FormInputItem, { type: InputVarType.singleFile }>> = {}): FormInputItem => ({
  type: InputVarType.singleFile,
  output_variable_name: 'field',
  allowed_file_extensions: [],
  allowed_file_types: [SupportUploadFileTypes.image],
  allowed_file_upload_methods: [TransferMethod.local_file],
  ...overrides,
})

const fileListInput = (overrides: Partial<Extract<FormInputItem, { type: InputVarType.multiFiles }>> = {}): FormInputItem => ({
  type: InputVarType.multiFiles,
  output_variable_name: 'field',
  allowed_file_extensions: [],
  allowed_file_types: [SupportUploadFileTypes.image],
  allowed_file_upload_methods: [TransferMethod.local_file],
  number_limits: 5,
  ...overrides,
})

describe('human-input utils', () => {
  describe('getButtonStyle', () => {
    it('should map all supported button styles', () => {
      expect(getButtonStyle(UserActionButtonType.Primary)).toBe('primary')
      expect(getButtonStyle(UserActionButtonType.Default)).toBe('secondary')
      expect(getButtonStyle(UserActionButtonType.Accent)).toBe('secondary-accent')
      expect(getButtonStyle(UserActionButtonType.Ghost)).toBe('ghost')
    })

    it('should return undefined for unsupported style values', () => {
      expect(getButtonStyle('unknown' as UserActionButtonType)).toBeUndefined()
    })
  })

  describe('splitByOutputVar', () => {
    it('should split content around output variable placeholders', () => {
      expect(splitByOutputVar('Hello {{#$output.user_name#}}!')).toEqual([
        'Hello ',
        '{{#$output.user_name#}}',
        '!',
      ])
    })

    it('should return original content when no placeholders exist', () => {
      expect(splitByOutputVar('no placeholders')).toEqual(['no placeholders'])
    })
  })

  describe('initializeInputs', () => {
    it('should initialize paragraph fields with constants and variable defaults', () => {
      const formInputs: FormInputItem[] = [
        paragraphInput({
          output_variable_name: 'name',
          default: { type: 'constant', value: 'John', selector: [] },
        }),
        paragraphInput({
          output_variable_name: 'bio',
          default: { type: 'variable', value: '', selector: [] },
        }),
      ]

      expect(initializeInputs(formInputs, { bio: 'Lives in Berlin' })).toEqual({
        name: 'John',
        bio: 'Lives in Berlin',
      })
    })

    it('should initialize select fields with empty strings', () => {
      const formInputs: FormInputItem[] = [
        selectInput({
          output_variable_name: 'role',
        }),
      ]

      expect(initializeInputs(formInputs)).toEqual({
        role: '',
      })
    })

    it('should initialize single file fields with null', () => {
      const formInputs: FormInputItem[] = [
        fileInput({
          output_variable_name: 'avatar',
        }),
      ]

      expect(initializeInputs(formInputs)).toEqual({
        avatar: null,
      })
    })

    it('should initialize file list fields with empty arrays', () => {
      const formInputs: FormInputItem[] = [
        fileListInput({
          output_variable_name: 'attachments',
        }),
      ]

      expect(initializeInputs(formInputs)).toEqual({
        attachments: [],
      })
    })

    it('should fallback to empty string when variable default is missing', () => {
      const formInputs: FormInputItem[] = [
        paragraphInput({
          output_variable_name: 'summary',
          default: { type: 'variable', value: '', selector: [] },
        }),
      ]

      expect(initializeInputs(formInputs, {})).toEqual({
        summary: '',
      })
    })

    it('should fallback to default paragraph values when resolved defaults are not strings', () => {
      const formInputs: FormInputItem[] = [
        paragraphInput({
          output_variable_name: 'summary',
          default: { type: 'variable', value: '', selector: [] },
        }),
      ]

      expect(initializeInputs(formInputs, {
        summary: {
          related_id: 'file-1',
          size: 128,
          extension: '.pdf',
          filename: 'brief.pdf',
          mime_type: 'application/pdf',
          transfer_method: TransferMethod.local_file,
          type: 'document',
          url: 'https://example.com/brief.pdf',
          upload_file_id: 'upload-file-1',
          remote_url: '',
        },
      })).toEqual({
        summary: '',
      })
    })

    it('should ignore resolved defaults for non-paragraph fields', () => {
      const formInputs: FormInputItem[] = [
        selectInput({
          output_variable_name: 'role',
        }),
        fileInput({
          output_variable_name: 'avatar',
        }),
        fileListInput({
          output_variable_name: 'attachments',
        }),
      ]

      expect(initializeInputs(formInputs, {
        role: 'maintainer',
        avatar: {
          related_id: 'file-2',
          size: 64,
          extension: '.png',
          filename: 'avatar.png',
          mime_type: 'image/png',
          transfer_method: TransferMethod.local_file,
          type: 'image',
          url: 'https://example.com/avatar.png',
          upload_file_id: 'upload-file-2',
          remote_url: '',
        },
        attachments: [{
          related_id: 'file-3',
          size: 16,
          extension: '.txt',
          filename: 'notes.txt',
          mime_type: 'text/plain',
          transfer_method: TransferMethod.local_file,
          type: 'document',
          url: 'https://example.com/notes.txt',
          upload_file_id: 'upload-file-3',
          remote_url: '',
        }],
      })).toEqual({
        role: '',
        avatar: null,
        attachments: [],
      })
    })
  })

  describe('time helpers', () => {
    it('should format relative time for supported and fallback locales', () => {
      const now = Date.now()
      const twoMinutesAgo = now - 2 * 60 * 1000

      expect(getRelativeTime(twoMinutesAgo, 'en-US')).toMatch(/ago/i)
      expect(getRelativeTime(twoMinutesAgo, 'es-ES' as Locale)).toMatch(/ago/i)
    })

    it('should compare utc timestamp against current time', () => {
      const now = Date.now()
      expect(isRelativeTimeSameOrAfter(now + 60_000)).toBe(true)
      expect(isRelativeTimeSameOrAfter(now - 60_000)).toBe(false)
    })
  })
})
