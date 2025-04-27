import { InputVarType } from '@/app/components/workflow/types'
import { MAX_VAR_KEY_LENGTH } from '@/config'
import type { TFunction } from 'i18next'
import { z } from 'zod'
import type { SchemaOptions } from './types'

export const TEXT_MAX_LENGTH = 256

export const InputType = z.enum([
  'text-input',
  'paragraph',
  'number',
  'select',
  'checkbox',
  'file',
  'file-list',
])

export const TransferMethod = z.enum([
  'all',
  'local_file',
  'remote_url',
])

export const SupportedFileTypes = z.enum([
  'image',
  'document',
  'video',
  'audio',
  'custom',
])

export const createInputFieldSchema = (type: InputVarType, t: TFunction, options: SchemaOptions) => {
  const { maxFileUploadLimit } = options
  const commonSchema = z.object({
    type: InputType,
    variable: z.string({
      invalid_type_error: t('appDebug.varKeyError.notValid', { key: t('appDebug.variableConfig.varName') }),
    }).nonempty({
      message: t('appDebug.varKeyError.canNoBeEmpty', { key: t('appDebug.variableConfig.varName') }),
    }).max(MAX_VAR_KEY_LENGTH, {
      message: t('appDebug.varKeyError.tooLong', { key: t('appDebug.variableConfig.varName') }),
    }).regex(/^(?!\d)\w+/, {
      message: t('appDebug.varKeyError.notStartWithNumber', { key: t('appDebug.variableConfig.varName') }),
    }),
    label: z.string().nonempty({
      message: t('appDebug.variableConfig.errorMsg.labelNameRequired'),
    }),
    required: z.boolean(),
    hint: z.string().optional(),
  })
  if (type === InputVarType.textInput || type === InputVarType.paragraph) {
    return z.object({
      maxLength: z.number().min(1).max(TEXT_MAX_LENGTH),
      default: z.string().optional(),
    }).merge(commonSchema).passthrough()
  }
  if (type === InputVarType.number) {
    return z.object({
      default: z.number().optional(),
      unit: z.string().optional(),
      placeholder: z.string().optional(),
    }).merge(commonSchema).passthrough()
  }
  if (type === InputVarType.select) {
    return z.object({
      options: z.array(z.string()).nonempty({
        message: t('appDebug.variableConfig.errorMsg.atLeastOneOption'),
      }).refine(
        arr => new Set(arr).size === arr.length,
        {
          message: t('appDebug.variableConfig.errorMsg.optionRepeat'),
        },
      ),
      default: z.string().optional(),
    }).merge(commonSchema).passthrough()
  }
  if (type === InputVarType.singleFile) {
    return z.object({
      allowedFileUploadMethods: z.array(TransferMethod),
      allowedTypesAndExtensions: z.object({
        allowedFileExtensions: z.array(z.string()).optional(),
        allowedFileTypes: z.array(SupportedFileTypes),
      }),
    }).merge(commonSchema).passthrough()
  }
  if (type === InputVarType.multiFiles) {
    return z.object({
      allowedFileUploadMethods: z.array(TransferMethod),
      allowedTypesAndExtensions: z.object({
        allowedFileExtensions: z.array(z.string()).optional(),
        allowedFileTypes: z.array(SupportedFileTypes),
      }),
      maxLength: z.number().min(1).max(maxFileUploadLimit),
    }).merge(commonSchema).passthrough()
  }
  return commonSchema.passthrough()
}
