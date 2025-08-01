import { MAX_VAR_KEY_LENGTH } from '@/config'
import type { TFunction } from 'i18next'
import { z } from 'zod'
import type { SchemaOptions } from './types'
import { PipelineInputVarType } from '@/models/pipeline'
import { InputTypeEnum } from '@/app/components/base/form/components/field/input-type-select/types'

export const TEXT_MAX_LENGTH = 256

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

export const createInputFieldSchema = (type: PipelineInputVarType, t: TFunction, options: SchemaOptions) => {
  const { maxFileUploadLimit } = options
  const commonSchema = z.object({
    type: InputTypeEnum,
    variable: z.string().nonempty({
      message: t('appDebug.varKeyError.canNoBeEmpty', { key: t('appDebug.variableConfig.varName') }),
    }).max(MAX_VAR_KEY_LENGTH, {
      message: t('appDebug.varKeyError.tooLong', { key: t('appDebug.variableConfig.varName') }),
    }).regex(/^(?!\d)\w+/, {
      message: t('appDebug.varKeyError.notStartWithNumber', { key: t('appDebug.variableConfig.varName') }),
    }).regex(/^[a-zA-Z_]\w{0,29}$/, {
      message: t('appDebug.varKeyError.notValid', { key: t('appDebug.variableConfig.varName') }),
    }),
    label: z.string().nonempty({
      message: t('appDebug.variableConfig.errorMsg.labelNameRequired'),
    }),
    required: z.boolean(),
    tooltips: z.string().optional(),
  })
  if (type === PipelineInputVarType.textInput || type === PipelineInputVarType.paragraph) {
    return z.object({
      maxLength: z.number().min(1).max(TEXT_MAX_LENGTH),
      default: z.string().optional(),
    }).merge(commonSchema).passthrough()
  }
  if (type === PipelineInputVarType.number) {
    return z.object({
      default: z.number().optional(),
      unit: z.string().optional(),
      placeholder: z.string().optional(),
    }).merge(commonSchema).passthrough()
  }
  if (type === PipelineInputVarType.select) {
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
  if (type === PipelineInputVarType.singleFile) {
    return z.object({
      allowedFileUploadMethods: z.array(TransferMethod),
      allowedTypesAndExtensions: z.object({
        allowedFileExtensions: z.array(z.string()).optional(),
        allowedFileTypes: z.array(SupportedFileTypes),
      }),
    }).merge(commonSchema).passthrough()
  }
  if (type === PipelineInputVarType.multiFiles) {
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
