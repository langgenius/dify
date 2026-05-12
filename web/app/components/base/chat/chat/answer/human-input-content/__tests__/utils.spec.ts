import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Locale } from '@/i18n-config/language'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import {
  getButtonStyle,
  getRelativeTime,
  initializeInputs,
  isRelativeTimeSameOrAfter,
  splitByOutputVar,
} from '../utils'

const createInput = (overrides: Partial<FormInputItem>): FormInputItem => ({
  label: 'field',
  variable: 'field',
  required: false,
  max_length: 128,
  type: InputVarType.textInput,
  default: {
    type: 'constant' as const,
    value: '',
    selector: [], // Dummy selector
  },
  output_variable_name: 'field',
  ...overrides,
} as unknown as FormInputItem)

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
    it('should initialize text fields with constants and variable defaults', () => {
      const formInputs = [
        createInput({
          type: InputVarType.textInput,
          output_variable_name: 'name',
          default: { type: 'constant', value: 'John', selector: [] },
        }),
        createInput({
          type: InputVarType.paragraph,
          output_variable_name: 'bio',
          default: { type: 'variable', value: '', selector: [] },
        }),
      ]

      expect(initializeInputs(formInputs, { bio: 'Lives in Berlin' })).toEqual({
        name: 'John',
        bio: 'Lives in Berlin',
      })
    })

    it('should set non text-like inputs to undefined', () => {
      const formInputs = [
        createInput({
          type: InputVarType.select,
          output_variable_name: 'role',
        }),
      ]

      expect(initializeInputs(formInputs)).toEqual({
        role: undefined,
      })
    })

    it('should fallback to empty string when variable default is missing', () => {
      const formInputs = [
        createInput({
          type: InputVarType.textInput,
          output_variable_name: 'summary',
          default: { type: 'variable', value: '', selector: [] },
        }),
      ]

      expect(initializeInputs(formInputs, {})).toEqual({
        summary: '',
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
