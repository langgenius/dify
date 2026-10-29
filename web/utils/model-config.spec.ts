import type { PromptVariable } from '@/models/debug'
import type { UserInputFormItem } from '@/types/app'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import {
  formatBooleanInputs,
  promptVariablesToUserInputsForm,
  userInputsFormToPromptVariables,
} from './model-config'

const getTextInput = (item: UserInputFormItem | undefined) => {
  if (!item || !('text-input' in item)) throw new Error('Expected text-input user input form item')

  return item['text-input']
}

describe('Model Config Utilities', () => {
  describe('userInputsFormToPromptVariables', () => {
    it('should return empty array for null input', () => {
      const result = userInputsFormToPromptVariables(null)
      expect(result).toEqual([])
    })

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
        },
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
        },
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

    it('should convert file input to file prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          file: {
            label: 'Profile Picture',
            variable: 'profile_pic',
            required: false,
            allowed_file_types: [SupportUploadFileTypes.image],
            allowed_file_extensions: ['.jpg', '.png'],
            allowed_file_upload_methods: ['local_file', 'remote_url'],
            default: '',
            hide: false,
          },
        },
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

    it('should convert file-list input to file-list prompt variable', () => {
      const userInputs: UserInputFormItem[] = [
        {
          'file-list': {
            label: 'Documents',
            variable: 'documents',
            required: true,
            allowed_file_types: [SupportUploadFileTypes.document],
            allowed_file_extensions: ['.pdf', '.docx'],
            allowed_file_upload_methods: ['local_file'],
            max_length: 5,
            default: '',
            hide: false,
          },
        },
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

    it.each([
      [
        { file: { default: '', label: 'Attachment', variable: 'attachment' } },
        { number_limits: 1 },
      ],
      [{ 'file-list': { label: 'Attachments', variable: 'attachments' } }, {}],
    ])('should allow publishing a loaded file input with omitted restrictions', (input, config) => {
      const variables = userInputsFormToPromptVariables([input])
      const form = promptVariablesToUserInputsForm(variables)

      expect(variables[0]?.config).toEqual(config)
      expect(Object.keys(form[0]!)).toEqual(Object.keys(input))
      expect(userInputsFormToPromptVariables(form)[0]?.config).toEqual(config)
    })

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
        },
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

      expect(result[0]!.is_context_var).toBe(true)
    })
  })

  describe('promptVariablesToUserInputsForm', () => {
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
      expect(getTextInput(result[0]).variable).toBe('valid_key')
    })

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

      expect(getTextInput(result[0]).required).toBe(true)
      expect(getTextInput(result[1]).required).toBe(false)
    })
  })

  describe('formatBooleanInputs', () => {
    it('should return inputs unchanged when useInputs is null', () => {
      const inputs = { key1: 'value1', key2: 'value2' }
      const result = formatBooleanInputs(null, inputs)
      expect(result).toEqual(inputs)
    })

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

      const original = { ...inputs }
      const result = formatBooleanInputs(useInputs, inputs)
      expect(inputs).toEqual(original)

      expect(result).toEqual({
        accept_terms: true,
        subscribe: false,
        other_field: 'value',
      })
    })

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
        bool4: null,
      }

      const result = formatBooleanInputs(useInputs, inputs)

      expect(result?.bool1).toBe(true)
      expect(result?.bool2).toBe(false)
      expect(result?.bool3).toBe(true)
      expect(result?.bool4).toBe(false)
    })
  })

  describe('publishing loaded form fields', () => {
    it.each([
      {
        'text-input': {
          label: 'Name',
          variable: 'name',
          required: true,
          max_length: 50,
          default: 'Alice',
          hide: true,
        },
      },
      {
        paragraph: { label: 'Notes', variable: 'notes', required: false, default: 'Initial notes' },
      },
      { number: { label: 'Count', variable: 'count', required: false, default: 0 } },
      { checkbox: { label: 'Enabled', variable: 'enabled', required: true, default: false } },
      {
        select: {
          label: 'Choice',
          variable: 'choice',
          required: false,
          options: ['A', 'B'],
          default: 'B',
        },
      },
      {
        file: {
          default: '',
          label: 'Attachment',
          variable: 'attachment',
          required: true,
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
        },
      },
      {
        'file-list': {
          default: '',
          label: 'Documents',
          variable: 'documents',
          required: false,
          max_length: 5,
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: ['local_file', 'remote_url'],
        },
      },
      {
        json_object: {
          label: 'JSON',
          variable: 'json',
          required: false,
          default: '{"name":"Alice"}',
          json_schema: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
    ] satisfies UserInputFormItem[])(
      'preserves the field type, defaults, and restrictions for %j',
      (input) => {
        const variables = userInputsFormToPromptVariables([input])
        const restored = promptVariablesToUserInputsForm(variables)
        expect(restored).toMatchObject([input])
        expect(userInputsFormToPromptVariables(restored)).toEqual(variables)
      },
    )
  })
})
