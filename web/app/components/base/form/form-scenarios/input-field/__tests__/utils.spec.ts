import { InputFieldType } from '../types'
import { generateZodSchema } from '../utils'

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

  it('should ignore constraints for irrelevant field types', () => {
    const schema = generateZodSchema([
      {
        type: InputFieldType.numberInput,
        variable: 'num',
        label: 'Num',
        required: true,
        maxLength: 10, // maxLength is for textInput, should be ignored
        showConditions: [],
      },
      {
        type: InputFieldType.textInput,
        variable: 'text',
        label: 'Text',
        required: true,
        min: 1, // min is for numberInput, should be ignored
        max: 5, // max is for numberInput, should be ignored
        showConditions: [],
      },
    ])

    // Should still work based on their base types
    // num: 12345678901 (violates maxLength: 10 if it were applied)
    // text: 'long string here' (violates max: 5 if it were applied)
    expect(schema.safeParse({ num: 12345678901, text: 'long string here' }).success).toBe(true)
    expect(schema.safeParse({ num: 'not a number', text: 'hello' }).success).toBe(false)
  })
})
