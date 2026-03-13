import type { PromptVariable } from '@/models/debug'
import type { UserInputFormItem } from '@/types/app'
/**
 * Test suite for model configuration transformation utilities
 *
 * This module handles the conversion between two different representations of user input forms:
 * 1. UserInputFormItem: The form structure used in the UI
 * 2. PromptVariable: The variable structure used in prompts and model configuration
 *
 * Key functions:
 * - userInputsFormToPromptVariables: Converts UI form items to prompt variables
 * - promptVariablesToUserInputsForm: Converts prompt variables back to form items
 * - formatBooleanInputs: Ensures boolean inputs are properly typed
 */
import {
  formatBooleanInputs,
  promptVariablesToUserInputsForm,
  userInputsFormToPromptVariables,
} from './model-config'

describe('Model Config Utilities', () => {
  describe('userInputsFormToPromptVariables', () => {
    /**
     * Test handling of null or undefined input
     * Should return empty array when no inputs provided
     */
    it('should return empty array for null input', () => {
      const result = userInputsFormToPromptVariables(null)
      expect(result).toEqual([])
    })

    /**
     * Test conversion of text-input (string) type
     * Text inputs are the most common form field type
     */
    it('should convert text-input to string prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          'text-input': {
            label: 'User Name',
            variable: 'user_name',
            required: true,
            max_length: 100,
            default: '',
            hide: false,
          },
        },
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 'user_name',
        name: 'User Name',
        required: true,
        type: 'string',
        max_length: 100,
        options: [],
        is_context_var: false,
        hide: false,
        default: '',
      })
    })

    /**
     * Test conversion of paragraph type
     * Paragraphs are multi-line text inputs
     */
    it('should convert paragraph to paragraph prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          paragraph: {
            label: 'Description',
            variable: 'description',
            required: false,
            max_length: 500,
            default: '',
            hide: false,
          },
        },
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'description',
        name: 'Description',
        required: false,
        type: 'paragraph',
        max_length: 500,
        options: [],
        is_context_var: false,
        hide: false,
        default: '',
      })
    })

    /**
     * Test conversion of number type
     * Number inputs should preserve numeric constraints
     */
    it('should convert number input to number prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          number: {
            label: 'Age',
            variable: 'age',
            required: true,
            default: '',
            hide: false,
          },
        } as any,
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'age',
        name: 'Age',
        required: true,
        type: 'number',
        options: [],
        hide: false,
        default: '',
      })
    })

    /**
     * Test conversion of checkbox (boolean) type
     * Checkboxes are converted to 'checkbox' type in prompt variables
     */
    it('should convert checkbox to checkbox prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          checkbox: {
            label: 'Accept Terms',
            variable: 'accept_terms',
            required: true,
            default: '',
            hide: false,
          },
        } as any,
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'accept_terms',
        name: 'Accept Terms',
        required: true,
        type: 'checkbox',
        options: [],
        hide: false,
        default: '',
      })
    })

    /**
     * Test conversion of select (dropdown) type
     * Select inputs include options array
     */
    it('should convert select input to select prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          select: {
            label: 'Country',
            variable: 'country',
            required: true,
            options: ['USA', 'Canada', 'Mexico'],
            default: 'USA',
            hide: false,
          },
        },
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'country',
        name: 'Country',
        required: true,
        type: 'select',
        options: ['USA', 'Canada', 'Mexico'],
        is_context_var: false,
        hide: false,
        default: 'USA',
      })
    })

    /**
     * Test conversion of file upload type
     * File inputs include configuration for allowed types and upload methods
     */
    it('should convert file input to file prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          file: {
            label: 'Profile Picture',
            variable: 'profile_pic',
            required: false,
            allowed_file_types: ['image'],
            allowed_file_extensions: ['.jpg', '.png'],
            allowed_file_upload_methods: ['local_file', 'remote_url'],
            default: '',
            hide: false,
          },
        } as any,
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'profile_pic',
        name: 'Profile Picture',
        required: false,
        type: 'file',
        config: {
          allowed_file_types: ['image'],
          allowed_file_extensions: ['.jpg', '.png'],
          allowed_file_upload_methods: ['local_file', 'remote_url'],
          number_limits: 1,
        },
        hide: false,
        default: '',
      })
    })

    /**
     * Test conversion of file-list type
     * File lists allow multiple file uploads with a max_length constraint
     */
    it('should convert file-list input to file-list prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          'file-list': {
            label: 'Documents',
            variable: 'documents',
            required: true,
            allowed_file_types: ['document'],
            allowed_file_extensions: ['.pdf', '.docx'],
            allowed_file_upload_methods: ['local_file'],
            max_length: 5,
            default: '',
            hide: false,
          },
        } as any,
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'documents',
        name: 'Documents',
        required: true,
        type: 'file-list',
        config: {
          allowed_file_types: ['document'],
          allowed_file_extensions: ['.pdf', '.docx'],
          allowed_file_upload_methods: ['local_file'],
          number_limits: 5,
        },
        hide: false,
        default: '',
      })
    })

    /**
     * Test conversion of external_data_tool type
     * External data tools have custom configuration and icons
     */
    it('should convert external_data_tool to prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          external_data_tool: {
            label: 'API Data',
            variable: 'api_data',
            type: 'api',
            enabled: true,
            required: false,
            config: { endpoint: 'https://api.example.com' },
            icon: 'api-icon',
            icon_background: '#FF5733',
            hide: false,
          },
        } as any,
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result[0]).toEqual({
        key: 'api_data',
        name: 'API Data',
        required: false,
        type: 'api',
        enabled: true,
        config: { endpoint: 'https://api.example.com' },
        icon: 'api-icon',
        icon_background: '#FF5733',
        is_context_var: false,
        hide: false,
      })
    })

    /**
     * Test handling of dataset_query_variable
     * When a variable matches the dataset_query_variable, is_context_var should be true
     */
    it('should mark variable as context var when matching dataset_query_variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          'text-input': {
            label: 'Query',
            variable: 'query',
            required: true,
            max_length: 200,
            default: '',
            hide: false,
          },
        },
      ]

      const result = userInputsFormToPromptVariables(userInputs, 'query')

      expect(result[0].is_context_var).toBe(true)
    })

    /**
     * Test conversion of multiple mixed input types
     * Should handle an array with different input types correctly
     */
    it('should convert multiple mixed input types', () => {
      const userInputs: UserInputFormItem[] = [
        {
          'text-input': {
            label: 'Name',
            variable: 'name',
            required: true,
            max_length: 50,
            default: '',
            hide: false,
          },
        },
        {
          number: {
            label: 'Age',
            variable: 'age',
            required: false,
            default: '',
            hide: false,
          },
        } as any,
        {
          select: {
            label: 'Gender',
            variable: 'gender',
            required: true,
            options: ['Male', 'Female', 'Other'],
            default: '',
            hide: false,
          },
        },
      ]

      const result = userInputsFormToPromptVariables(userInputs)

      expect(result).toHaveLength(3)
      expect(result[0].type).toBe('string')
      expect(result[1].type).toBe('number')
      expect(result[2].type).toBe('select')
    })
  })

  describe('promptVariablesToUserInputsForm', () => {
    /**
     * Test conversion of string prompt variable back to text-input
     */
    it('should convert string prompt variable to text-input', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'user_name',
          name: 'User Name',
          required: true,
          type: 'string',
          max_length: 100,
          options: [],
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        'text-input': {
          label: 'User Name',
          variable: 'user_name',
          required: true,
          max_length: 100,
          default: '',
          hide: undefined,
        },
      })
    })

    /**
     * Test conversion of paragraph prompt variable
     */
    it('should convert paragraph prompt variable to paragraph input', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'description',
          name: 'Description',
          required: false,
          type: 'paragraph',
          max_length: 500,
          options: [],
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result[0]).toEqual({
        paragraph: {
          label: 'Description',
          variable: 'description',
          required: false,
          max_length: 500,
          default: '',
          hide: undefined,
        },
      })
    })

    /**
     * Test conversion of number prompt variable
     */
    it('should convert number prompt variable to number input', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'age',
          name: 'Age',
          required: true,
          type: 'number',
          options: [],
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result[0]).toEqual({
        number: {
          label: 'Age',
          variable: 'age',
          required: true,
          default: '',
          hide: undefined,
        },
      })
    })

    /**
     * Test conversion of checkbox prompt variable
     */
    it('should convert checkbox prompt variable to checkbox input', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'accept_terms',
          name: 'Accept Terms',
          required: true,
          type: 'checkbox',
          options: [],
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result[0]).toEqual({
        checkbox: {
          label: 'Accept Terms',
          variable: 'accept_terms',
          required: true,
          default: '',
          hide: undefined,
        },
      })
    })

    /**
     * Test conversion of select prompt variable
     */
    it('should convert select prompt variable to select input', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'country',
          name: 'Country',
          required: true,
          type: 'select',
          options: ['USA', 'Canada', 'Mexico'],
          default: 'USA',
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result[0]).toEqual({
        select: {
          label: 'Country',
          variable: 'country',
          required: true,
          options: ['USA', 'Canada', 'Mexico'],
          default: 'USA',
          hide: undefined,
        },
      })
    })

    /**
     * Test filtering of invalid prompt variables
     * Variables without key or name should be filtered out
     */
    it('should filter out variables with empty key or name', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: '',
          name: 'Empty Key',
          required: true,
          type: 'string',
          options: [],
        },
        {
          key: 'valid',
          name: '',
          required: true,
          type: 'string',
          options: [],
        },
        {
          key: '  ',
          name: 'Whitespace Key',
          required: true,
          type: 'string',
          options: [],
        },
        {
          key: 'valid_key',
          name: 'Valid Name',
          required: true,
          type: 'string',
          options: [],
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result).toHaveLength(1)
      expect((result[0] as any)['text-input']?.variable).toBe('valid_key')
    })

    /**
     * Test conversion of external data tool prompt variable
     */
    it('should convert external data tool prompt variable', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'api_data',
          name: 'API Data',
          required: false,
          type: 'api',
          enabled: true,
          config: { endpoint: 'https://api.example.com' },
          icon: 'api-icon',
          icon_background: '#FF5733',
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect(result[0]).toEqual({
        external_data_tool: {
          label: 'API Data',
          variable: 'api_data',
          enabled: true,
          type: 'api',
          config: { endpoint: 'https://api.example.com' },
          required: false,
          icon: 'api-icon',
          icon_background: '#FF5733',
          hide: undefined,
        },
      })
    })

    /**
     * Test that required defaults to true when not explicitly set to false
     */
    it('should default required to true when not false', () => {
      const promptVariables: PromptVariable[] = [
        {
          key: 'test1',
          name: 'Test 1',
          required: undefined,
          type: 'string',
          options: [],
        },
        {
          key: 'test2',
          name: 'Test 2',
          required: false,
          type: 'string',
          options: [],
        },
      ]

      const result = promptVariablesToUserInputsForm(promptVariables)

      expect((result[0] as any)['text-input']?.required).toBe(true)
      expect((result[1] as any)['text-input']?.required).toBe(false)
    })
  })

  describe('formatBooleanInputs', () => {
    /**
     * Test that null or undefined inputs are handled gracefully
     */
    it('should return inputs unchanged when useInputs is null', () => {
      const inputs = { key1: 'value1', key2: 'value2' }
      const result = formatBooleanInputs(null, inputs)
      expect(result).toEqual(inputs)
    })

    it('should return inputs unchanged when useInputs is undefined', () => {
      const inputs = { key1: 'value1', key2: 'value2' }
      const result = formatBooleanInputs(undefined, inputs)
      expect(result).toEqual(inputs)
    })

    /**
     * Test conversion of boolean input values to actual boolean type
     * This is important for proper type handling in the backend
     * Note: checkbox inputs are converted to type 'checkbox' by userInputsFormToPromptVariables
     */
    it('should convert boolean inputs to boolean type', () => {
      const useInputs: PromptVariable[] = [
        {
          key: 'accept_terms',
          name: 'Accept Terms',
          required: true,
          type: 'checkbox',
          options: [],
        },
        {
          key: 'subscribe',
          name: 'Subscribe',
          required: false,
          type: 'checkbox',
          options: [],
        },
      ]

      const inputs = {
        accept_terms: 'true',
        subscribe: '',
        other_field: 'value',
      }

      const result = formatBooleanInputs(useInputs, inputs)

      expect(result).toEqual({
        accept_terms: true,
        subscribe: false,
        other_field: 'value',
      })
    })

    /**
     * Test that non-boolean inputs are not affected
     */
    it('should not modify non-boolean inputs', () => {
      const useInputs: PromptVariable[] = [
        {
          key: 'name',
          name: 'Name',
          required: true,
          type: 'string',
          options: [],
        },
        {
          key: 'age',
          name: 'Age',
          required: true,
          type: 'number',
          options: [],
        },
      ]

      const inputs = {
        name: 'John Doe',
        age: 30,
      }

      const result = formatBooleanInputs(useInputs, inputs)

      expect(result).toEqual(inputs)
    })

    /**
     * Test handling of truthy and falsy values for boolean conversion
     * Note: checkbox inputs are converted to type 'checkbox' by userInputsFormToPromptVariables
     */
    it('should handle various truthy and falsy values', () => {
      const useInputs: PromptVariable[] = [
        {
          key: 'bool1',
          name: 'Bool 1',
          required: true,
          type: 'checkbox',
          options: [],
        },
        {
          key: 'bool2',
          name: 'Bool 2',
          required: true,
          type: 'checkbox',
          options: [],
        },
        {
          key: 'bool3',
          name: 'Bool 3',
          required: true,
          type: 'checkbox',
          options: [],
        },
        {
          key: 'bool4',
          name: 'Bool 4',
          required: true,
          type: 'checkbox',
          options: [],
        },
      ]

      const inputs = {
        bool1: 1,
        bool2: 0,
        bool3: 'yes',
        bool4: null as any,
      }

      const result = formatBooleanInputs(useInputs, inputs)

      expect(result?.bool1).toBe(true)
      expect(result?.bool2).toBe(false)
      expect(result?.bool3).toBe(true)
      expect(result?.bool4).toBe(false)
    })

    /**
     * Test that the function creates a new object and doesn't mutate the original
     * Note: checkbox inputs are converted to type 'checkbox' by userInputsFormToPromptVariables
     */
    it('should not mutate original inputs object', () => {
      const useInputs: PromptVariable[] = [
        {
          key: 'flag',
          name: 'Flag',
          required: true,
          type: 'checkbox',
          options: [],
        },
      ]

      const inputs = { flag: 'true', other: 'value' }
      const originalInputs = { ...inputs }

      formatBooleanInputs(useInputs, inputs)

      expect(inputs).toEqual(originalInputs)
    })
  })

  describe('Round-trip conversion', () => {
    /**
     * Test that converting from UserInputForm to PromptVariable and back
     * preserves the essential data (though some fields may have defaults applied)
     */
    it('should preserve data through round-trip conversion', () => {
      const originalUserInputs: UserInputFormItem[] = [
        {
          'text-input': {
            label: 'Name',
            variable: 'name',
            required: true,
            max_length: 50,
            default: '',
            hide: false,
          },
        },
        {
          select: {
            label: 'Type',
            variable: 'type',
            required: false,
            options: ['A', 'B', 'C'],
            default: 'A',
            hide: false,
          },
        },
      ]

      const promptVars = userInputsFormToPromptVariables(originalUserInputs)
      const backToUserInputs = promptVariablesToUserInputsForm(promptVars)

      expect(backToUserInputs).toHaveLength(2)
      expect((backToUserInputs[0] as any)['text-input']?.variable).toBe('name')
      expect((backToUserInputs[1] as any).select?.variable).toBe('type')
      expect((backToUserInputs[1] as any).select?.options).toEqual(['A', 'B', 'C'])
    })
  })
})
