import type { ZodSchema, ZodString } from 'zod'
import { z } from 'zod'
import { type InputFieldConfiguration, InputFieldType } from './types'
import { SupportedFileTypes, TransferMethod } from '@/app/components/rag-pipeline/components/panel/input-field/editor/form/schema'

export const generateZodSchema = (fields: InputFieldConfiguration[]) => {
  const shape: Record<string, ZodSchema> = {}

  fields.forEach((field) => {
    let zodType

    switch (field.type) {
      case InputFieldType.textInput:
        zodType = z.string()
        break
      case InputFieldType.numberInput:
        zodType = z.number()
        break
      case InputFieldType.numberSlider:
        zodType = z.number()
        break
      case InputFieldType.checkbox:
        zodType = z.boolean()
        break
      case InputFieldType.options:
        zodType = z.array(z.string())
        break
      case InputFieldType.select:
        zodType = z.string()
        break
      case InputFieldType.fileTypes:
        zodType = z.object({
          allowedFileExtensions: z.string().optional(),
          allowedFileTypes: z.array(SupportedFileTypes),
        })
        break
      case InputFieldType.inputTypeSelect:
        zodType = z.string()
        break
      case InputFieldType.uploadMethod:
        zodType = z.array(TransferMethod)
        break
      default:
        zodType = z.any()
        break
    }

    if (field.maxLength) {
      if ([InputFieldType.textInput].includes(field.type))
        zodType = (zodType as ZodString).max(field.maxLength, `${field.label} exceeds max length of ${field.maxLength}`)
    }

    if (field.min) {
      if ([InputFieldType.numberInput].includes(field.type))
        zodType = (zodType as ZodString).min(field.min, `${field.label} must be at least ${field.min}`)
    }

    if (field.max) {
      if ([InputFieldType.numberInput].includes(field.type))
        zodType = (zodType as ZodString).max(field.max, `${field.label} exceeds max value of ${field.max}`)
    }

    if (field.required) {
      if ([InputFieldType.textInput].includes(field.type))
        zodType = (zodType as ZodString).nonempty(`${field.label} is required`)
    }
    else {
      zodType = zodType.optional()
    }

    shape[field.variable] = zodType
  })

  return z.object(shape)
}
