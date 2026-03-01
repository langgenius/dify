import { InputVarType } from '@/app/components/workflow/types'
import {
  checkKey,
  checkKeys,
  getMarketplaceUrl,
  getNewVar,
  getNewVarInWorkflow,
  getVars,
  hasDuplicateStr,
  replaceSpaceWithUnderscoreInVarNameInput,
} from './var'

describe('Variable Utilities', () => {
  describe('checkKey', () => {
    it('should return error for empty key when canBeEmpty is false', () => {
      expect(checkKey('', false)).toBe('canNoBeEmpty')
    })

    it('should return true for empty key when canBeEmpty is true', () => {
      expect(checkKey('', true)).toBe(true)
    })

    it('should return error for key that is too long', () => {
      const longKey = 'a'.repeat(101) // Assuming MAX_VAR_KEY_LENGTH is 100
      expect(checkKey(longKey)).toBe('tooLong')
    })

    it('should return error for key starting with number', () => {
      expect(checkKey('1variable')).toBe('notStartWithNumber')
    })

    it('should return true for valid key', () => {
      expect(checkKey('valid_variable_name')).toBe(true)
      expect(checkKey('validVariableName')).toBe(true)
      expect(checkKey('valid123')).toBe(true)
    })

    it('should return error for invalid characters', () => {
      expect(checkKey('invalid-key')).toBe('notValid')
      expect(checkKey('invalid key')).toBe('notValid')
      expect(checkKey('invalid.key')).toBe('notValid')
      expect(checkKey('invalid@key')).toBe('notValid')
    })

    it('should handle underscore correctly', () => {
      expect(checkKey('_valid')).toBe(true)
      expect(checkKey('valid_name')).toBe(true)
      expect(checkKey('valid_name_123')).toBe(true)
    })
  })

  describe('checkKeys', () => {
    it('should return valid for all valid keys', () => {
      const result = checkKeys(['key1', 'key2', 'validKey'])
      expect(result.isValid).toBe(true)
      expect(result.errorKey).toBe('')
      expect(result.errorMessageKey).toBe('')
    })

    it('should return error for first invalid key', () => {
      const result = checkKeys(['validKey', '1invalid', 'anotherValid'])
      expect(result.isValid).toBe(false)
      expect(result.errorKey).toBe('1invalid')
      expect(result.errorMessageKey).toBe('notStartWithNumber')
    })

    it('should handle empty array', () => {
      const result = checkKeys([])
      expect(result.isValid).toBe(true)
    })

    it('should stop checking after first error', () => {
      const result = checkKeys(['valid', 'invalid-key', '1invalid'])
      expect(result.isValid).toBe(false)
      expect(result.errorKey).toBe('invalid-key')
      expect(result.errorMessageKey).toBe('notValid')
    })
  })

  describe('hasDuplicateStr', () => {
    it('should return false for unique strings', () => {
      expect(hasDuplicateStr(['a', 'b', 'c'])).toBe(false)
    })

    it('should return true for duplicate strings', () => {
      expect(hasDuplicateStr(['a', 'b', 'a'])).toBe(true)
      expect(hasDuplicateStr(['test', 'test'])).toBe(true)
    })

    it('should handle empty array', () => {
      expect(hasDuplicateStr([])).toBe(false)
    })

    it('should handle single element', () => {
      expect(hasDuplicateStr(['single'])).toBe(false)
    })

    it('should handle multiple duplicates', () => {
      expect(hasDuplicateStr(['a', 'b', 'a', 'b', 'c'])).toBe(true)
    })
  })

  describe('getVars', () => {
    it('should extract variables from template string', () => {
      const result = getVars('Hello {{name}}, your age is {{age}}')
      expect(result).toEqual(['name', 'age'])
    })

    it('should handle empty string', () => {
      expect(getVars('')).toEqual([])
    })

    it('should handle string without variables', () => {
      expect(getVars('Hello world')).toEqual([])
    })

    it('should remove duplicate variables', () => {
      const result = getVars('{{name}} and {{name}} again')
      expect(result).toEqual(['name'])
    })

    it('should filter out placeholder variables', () => {
      const result = getVars('{{#context#}} {{name}} {{#histories#}}')
      expect(result).toEqual(['name'])
    })

    it('should handle variables with underscores', () => {
      const result = getVars('{{user_name}} {{user_age}}')
      expect(result).toEqual(['user_name', 'user_age'])
    })

    it('should handle variables with numbers', () => {
      const result = getVars('{{var1}} {{var2}} {{var123}}')
      expect(result).toEqual(['var1', 'var2', 'var123'])
    })

    it('should ignore invalid variable names', () => {
      const result = getVars('{{1invalid}} {{valid}} {{-invalid}}')
      expect(result).toEqual(['valid'])
    })

    it('should filter out variables that are too long', () => {
      const longVar = 'a'.repeat(101)
      const result = getVars(`{{${longVar}}} {{valid}}`)
      expect(result).toEqual(['valid'])
    })
  })

  describe('getNewVar', () => {
    it('should create new string variable', () => {
      const result = getNewVar('testKey', 'string')
      expect(result.key).toBe('testKey')
      expect(result.type).toBe('string')
      expect(result.name).toBe('testKey')
    })

    it('should create new number variable', () => {
      const result = getNewVar('numKey', 'number')
      expect(result.key).toBe('numKey')
      expect(result.type).toBe('number')
    })

    it('should truncate long names', () => {
      const longKey = 'a'.repeat(100)
      const result = getNewVar(longKey, 'string')
      expect(result.name.length).toBeLessThanOrEqual(result.key.length)
    })
  })

  describe('getNewVarInWorkflow', () => {
    it('should create text input variable by default', () => {
      const result = getNewVarInWorkflow('testVar')
      expect(result.variable).toBe('testVar')
      expect(result.type).toBe(InputVarType.textInput)
      expect(result.label).toBe('testVar')
    })

    it('should create select variable', () => {
      const result = getNewVarInWorkflow('selectVar', InputVarType.select)
      expect(result.variable).toBe('selectVar')
      expect(result.type).toBe(InputVarType.select)
    })

    it('should create number variable', () => {
      const result = getNewVarInWorkflow('numVar', InputVarType.number)
      expect(result.variable).toBe('numVar')
      expect(result.type).toBe(InputVarType.number)
    })
  })

  describe('getMarketplaceUrl', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { origin: 'https://example.com' },
        writable: true,
      })
    })

    it('should add additional parameters', () => {
      const url = getMarketplaceUrl('/plugins', { category: 'ai', version: '1.0' })
      expect(url).toContain('category=ai')
      expect(url).toContain('version=1.0')
    })

    it('should skip undefined parameters', () => {
      const url = getMarketplaceUrl('/plugins', { category: 'ai', version: undefined })
      expect(url).toContain('category=ai')
      expect(url).not.toContain('version=')
    })
  })

  describe('replaceSpaceWithUnderscoreInVarNameInput', () => {
    it('should replace spaces with underscores', () => {
      const input = document.createElement('input')
      input.value = 'test variable name'
      replaceSpaceWithUnderscoreInVarNameInput(input)
      expect(input.value).toBe('test_variable_name')
    })

    it('should preserve cursor position', () => {
      const input = document.createElement('input')
      input.value = 'test name'
      input.setSelectionRange(5, 5)
      replaceSpaceWithUnderscoreInVarNameInput(input)
      expect(input.selectionStart).toBe(5)
      expect(input.selectionEnd).toBe(5)
    })

    it('should handle multiple spaces', () => {
      const input = document.createElement('input')
      input.value = 'test  multiple   spaces'
      replaceSpaceWithUnderscoreInVarNameInput(input)
      expect(input.value).toBe('test__multiple___spaces')
    })
  })
})
