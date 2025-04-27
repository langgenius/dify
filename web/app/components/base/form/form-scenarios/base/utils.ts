import type { ZodSchema, ZodString } from 'zod'
import { z } from 'zod'
import { type BaseConfiguration, BaseVarType } from './types'

export const generateZodSchema = <T>(fields: BaseConfiguration<T>[]) => {
  const shape: Record<string, ZodSchema> = {}

  fields.forEach((field) => {
    let zodType

    switch (field.type) {
      case BaseVarType.textInput:
        zodType = z.string()
        break
      case BaseVarType.numberInput:
        zodType = z.number()
        break
      case BaseVarType.checkbox:
        zodType = z.boolean()
        break
      case BaseVarType.select:
        zodType = z.string()
        break
      default:
        zodType = z.any()
        break
    }

    if (field.required) {
      if ([BaseVarType.textInput].includes(field.type))
        zodType = (zodType as ZodString).nonempty(`${field.label} is required`)
    }
    else {
      zodType = zodType.optional()
    }

    if (field.maxLength) {
      if ([BaseVarType.textInput].includes(field.type))
        zodType = (zodType as ZodString).max(field.maxLength, `${field.label} exceeds max length of ${field.maxLength}`)
    }

    if (field.min) {
      if ([BaseVarType.numberInput].includes(field.type))
        zodType = (zodType as ZodString).min(field.min, `${field.label} must be at least ${field.min}`)
    }

    if (field.max) {
      if ([BaseVarType.numberInput].includes(field.type))
        zodType = (zodType as ZodString).max(field.max, `${field.label} exceeds max value of ${field.max}`)
    }

    shape[field.variable] = zodType
  })

  return z.object(shape)
}
