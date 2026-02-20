import { InputFieldType } from './types'
import { generateZodSchema } from './utils'

describe('input-field scenario schema generator', () => {
  it('should validate required text input with max length', () => {
    const schema = generateZodSchema([{
      type: InputFieldType.textInput,
      variable: 'prompt',
      label: 'Prompt',
      required: true,
      maxLength: 5,
      showConditions: [],
    }])

    expect(schema.safeParse({ prompt: 'hello' }).success).toBe(true)
    expect(schema.safeParse({ prompt: '' }).success).toBe(false)
    expect(schema.safeParse({ prompt: 'longer than five' }).success).toBe(false)
  })

  it('should validate file types payload shape', () => {
    const schema = generateZodSchema([{
      type: InputFieldType.fileTypes,
      variable: 'files',
      label: 'Files',
      required: true,
      showConditions: [],
    }])

    expect(schema.safeParse({
      files: {
        allowedFileExtensions: 'txt,pdf',
        allowedFileTypes: ['document'],
      },
    }).success).toBe(true)

    expect(schema.safeParse({
      files: {
        allowedFileTypes: ['invalid-type'],
      },
    }).success).toBe(false)
  })

  it('should allow optional upload method fields to be omitted', () => {
    const schema = generateZodSchema([{
      type: InputFieldType.uploadMethod,
      variable: 'methods',
      label: 'Methods',
      required: false,
      showConditions: [],
    }])

    expect(schema.safeParse({}).success).toBe(true)
  })

  it('should validate numeric bounds and other field type shapes', () => {
    const schema = generateZodSchema([
      {
        type: InputFieldType.numberInput,
        variable: 'count',
        label: 'Count',
        required: true,
        min: 1,
        max: 3,
        showConditions: [],
      },
      {
        type: InputFieldType.numberSlider,
        variable: 'temperature',
        label: 'Temperature',
        required: true,
        showConditions: [],
      },
      {
        type: InputFieldType.checkbox,
        variable: 'enabled',
        label: 'Enabled',
        required: true,
        showConditions: [],
      },
      {
        type: InputFieldType.options,
        variable: 'choices',
        label: 'Choices',
        required: true,
        showConditions: [],
      },
      {
        type: InputFieldType.select,
        variable: 'mode',
        label: 'Mode',
        required: true,
        showConditions: [],
      },
      {
        type: InputFieldType.inputTypeSelect,
        variable: 'inputType',
        label: 'Input Type',
        required: true,
        showConditions: [],
      },
      {
        type: InputFieldType.uploadMethod,
        variable: 'methods',
        label: 'Methods',
        required: true,
        showConditions: [],
      },
      {
        type: 'unsupported' as InputFieldType,
        variable: 'other',
        label: 'Other',
        required: true,
        showConditions: [],
      },
    ])

    expect(schema.safeParse({
      count: 2,
      temperature: 0.5,
      enabled: true,
      choices: ['a'],
      mode: 'safe',
      inputType: 'text',
      methods: ['local_file'],
      other: { key: 'value' },
    }).success).toBe(true)

    expect(schema.safeParse({
      count: 0,
      temperature: 0.5,
      enabled: true,
      choices: ['a'],
      mode: 'safe',
      inputType: 'text',
      methods: ['local_file'],
      other: { key: 'value' },
    }).success).toBe(false)

    expect(schema.safeParse({
      count: 4,
      temperature: 0.5,
      enabled: true,
      choices: ['a'],
      mode: 'safe',
      inputType: 'text',
      methods: ['local_file'],
      other: { key: 'value' },
    }).success).toBe(false)
  })
})
