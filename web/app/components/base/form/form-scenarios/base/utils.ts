import type { ZodNumber, ZodSchema, ZodString } from 'zod'
import { z } from 'zod'
import { type BaseConfiguration, BaseFieldType } from './types'

export const generateZodSchema = (fields: BaseConfiguration[]) => {
  const shape: Record<string, ZodSchema> = {}

  fields.forEach((field) => {
    let zodType

    switch (field.type) {
      case BaseFieldType.textInput:
      case BaseFieldType.paragraph:
        zodType = z.string()
        break
      case BaseFieldType.numberInput:
        zodType = z.number()
        break
      case BaseFieldType.checkbox:
        zodType = z.boolean()
        break
      case BaseFieldType.select:
        zodType = z.string()
        break
      default:
        zodType = z.any()
        break
    }

    if (field.maxLength) {
      if ([BaseFieldType.textInput, BaseFieldType.paragraph].includes(field.type))
        zodType = (zodType as ZodString).max(field.maxLength, `${field.label} exceeds max length of ${field.maxLength}`)
    }

    if (field.min) {
      if ([BaseFieldType.numberInput].includes(field.type))
        zodType = (zodType as ZodNumber).min(field.min, `${field.label} must be at least ${field.min}`)
    }

    if (field.max) {
      if ([BaseFieldType.numberInput].includes(field.type))
        zodType = (zodType as ZodNumber).max(field.max, `${field.label} exceeds max value of ${field.max}`)
    }

    if (field.required) {
      if ([BaseFieldType.textInput, BaseFieldType.paragraph].includes(field.type))
        zodType = (zodType as ZodString).nonempty(`${field.label} is required`)
    }
    else {
      zodType = zodType.optional().nullable()
    }

    shape[field.variable] = zodType
  })

  return z.object(shape)
}
