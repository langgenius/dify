import { BaseFieldType } from '../types'
import { generateZodSchema } from '../utils'

describe('base scenario schema generator', () => {
  it('should validate required text fields with max length', () => {
    const schema = generateZodSchema([{
      type: BaseFieldType.textInput,
      variable: 'name',
      label: 'Name',
      required: true,
      maxLength: 3,
      showConditions: [],
    }])

    expect(schema.safeParse({ name: 'abc' }).success).toBe(true)
    expect(schema.safeParse({ name: '' }).success).toBe(false)
    expect(schema.safeParse({ name: 'abcd' }).success).toBe(false)
  })

  it('should validate number bounds', () => {
    const schema = generateZodSchema([{
      type: BaseFieldType.numberInput,
      variable: 'age',
      label: 'Age',
      required: true,
      min: 18,
      max: 30,
      showConditions: [],
    }])

    expect(schema.safeParse({ age: 20 }).success).toBe(true)
    expect(schema.safeParse({ age: 17 }).success).toBe(false)
    expect(schema.safeParse({ age: 31 }).success).toBe(false)
  })

  it('should allow optional fields to be undefined or null', () => {
    const schema = generateZodSchema([{
      type: BaseFieldType.select,
      variable: 'mode',
      label: 'Mode',
      required: false,
      showConditions: [],
      options: [{ value: 'safe', label: 'Safe' }],
    }])

    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ mode: null }).success).toBe(true)
  })

  it('should validate required checkbox values as booleans', () => {
    const schema = generateZodSchema([{
      type: BaseFieldType.checkbox,
      variable: 'accepted',
      label: 'Accepted',
      required: true,
      showConditions: [],
    }])

    expect(schema.safeParse({ accepted: true }).success).toBe(true)
    expect(schema.safeParse({ accepted: false }).success).toBe(true)
    expect(schema.safeParse({ accepted: 'yes' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('should fallback to any schema for unsupported field types', () => {
    const schema = generateZodSchema([{
      type: BaseFieldType.file,
      variable: 'attachment',
      label: 'Attachment',
      required: false,
      showConditions: [],
      allowedFileTypes: [],
      allowedFileExtensions: [],
      allowedFileUploadMethods: [],
    }])

    expect(schema.safeParse({ attachment: { id: 'file-1' } }).success).toBe(true)
    expect(schema.safeParse({ attachment: 'raw-string' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ attachment: null }).success).toBe(true)
  })

  it('should ignore numeric and text constraints for non-applicable field types', () => {
    const schema = generateZodSchema([{
      type: BaseFieldType.checkbox,
      variable: 'toggle',
      label: 'Toggle',
      required: true,
      showConditions: [],
      maxLength: 1,
      min: 10,
      max: 20,
    }])

    expect(schema.safeParse({ toggle: true }).success).toBe(true)
    expect(schema.safeParse({ toggle: false }).success).toBe(true)
    expect(schema.safeParse({ toggle: 1 }).success).toBe(false)
  })
})
