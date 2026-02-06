import type { TFunction } from 'i18next'
import type { SchemaOptions } from './types'
import * as z from 'zod'
import { InputTypeEnum } from '@/app/components/base/form/components/field/input-type-select/types'
import { MAX_VAR_KEY_LENGTH } from '@/config'
import { PipelineInputVarType } from '@/models/pipeline'

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
      message: t('varKeyError.canNoBeEmpty', { ns: 'appDebug', key: t('variableConfig.varName', { ns: 'appDebug' }) }),
    }).max(MAX_VAR_KEY_LENGTH, {
      message: t('varKeyError.tooLong', { ns: 'appDebug', key: t('variableConfig.varName', { ns: 'appDebug' }) }),
    }).regex(/^(?!\d)\w+/, {
      message: t('varKeyError.notStartWithNumber', { ns: 'appDebug', key: t('variableConfig.varName', { ns: 'appDebug' }) }),
    }).regex(/^[a-z_]\w{0,29}$/i, {
      message: t('varKeyError.notValid', { ns: 'appDebug', key: t('variableConfig.varName', { ns: 'appDebug' }) }),
    }),
    label: z.string().nonempty({
      message: t('variableConfig.errorMsg.labelNameRequired', { ns: 'appDebug' }),
    }),
    required: z.boolean(),
    tooltips: z.string().optional(),
  })
  if (type === PipelineInputVarType.textInput || type === PipelineInputVarType.paragraph) {
    return z.looseObject({
      maxLength: z.number().min(1).max(TEXT_MAX_LENGTH),
      default: z.string().optional(),
    }).extend(commonSchema.shape)
  }
  if (type === PipelineInputVarType.number) {
    return z.looseObject({
      default: z.number().optional(),
      unit: z.string().optional(),
      placeholder: z.string().optional(),
    }).extend(commonSchema.shape)
  }
  if (type === PipelineInputVarType.select) {
    return z.looseObject({
      options: z.tuple([z.string()], z.string()).refine(
        arr => new Set(arr).size === arr.length,
        {
          message: t('variableConfig.errorMsg.optionRepeat', { ns: 'appDebug' }),
        },
      ),
      default: z.string().optional(),
    }).extend(commonSchema.shape)
  }
  if (type === PipelineInputVarType.singleFile) {
    return z.looseObject({
      allowedFileUploadMethods: z.array(TransferMethod),
      allowedTypesAndExtensions: z.looseObject({
        allowedFileExtensions: z.array(z.string()).optional(),
        allowedFileTypes: z.array(SupportedFileTypes),
      }),
    }).extend(commonSchema.shape)
  }
  if (type === PipelineInputVarType.multiFiles) {
    return z.looseObject({
      allowedFileUploadMethods: z.array(TransferMethod),
      allowedTypesAndExtensions: z.looseObject({
        allowedFileExtensions: z.array(z.string()).optional(),
        allowedFileTypes: z.array(SupportedFileTypes),
      }),
      maxLength: z.number().min(1).max(maxFileUploadLimit),
    }).extend(commonSchema.shape)
  }
  return z.looseObject(commonSchema.shape)
}
