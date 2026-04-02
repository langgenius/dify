import type { Item as SelectItem } from './type-select'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'

export const TEXT_MAX_LENGTH = 256
export const CHECKBOX_DEFAULT_TRUE_VALUE = 'true'
export const CHECKBOX_DEFAULT_FALSE_VALUE = 'false'

type Translate = (key: string, options?: Record<string, unknown>) => string

type ValidateConfigModalPayloadOptions = {
  tempPayload: InputVar
  payload?: InputVar
  checkVariableName: (value: string, canBeEmpty?: boolean) => boolean
  t: Translate
}

type ValidateConfigModalPayloadResult = {
  payloadToSave?: InputVar
  moreInfo?: MoreInfo
  errorMessage?: string
}

export const isStringInputType = (type: InputVarType) =>
  type === InputVarType.textInput || type === InputVarType.paragraph

export const getCheckboxDefaultSelectValue = (value: InputVar['default'] | boolean) => {
  if (typeof value === 'boolean')
    return value ? CHECKBOX_DEFAULT_TRUE_VALUE : CHECKBOX_DEFAULT_FALSE_VALUE
  if (typeof value === 'string')
    return value.toLowerCase() === CHECKBOX_DEFAULT_TRUE_VALUE ? CHECKBOX_DEFAULT_TRUE_VALUE : CHECKBOX_DEFAULT_FALSE_VALUE
  return CHECKBOX_DEFAULT_FALSE_VALUE
}

export const parseCheckboxSelectValue = (value: string) =>
  value === CHECKBOX_DEFAULT_TRUE_VALUE

export const normalizeSelectDefaultValue = (inputVar: InputVar) => {
  if (inputVar.type === InputVarType.select && inputVar.default === '')
    return { ...inputVar, default: undefined }
  return inputVar
}

export const getJsonSchemaEditorValue = (type: InputVarType, jsonSchema?: InputVar['json_schema']) => {
  if (type !== InputVarType.jsonObject || !jsonSchema)
    return ''

  try {
    if (typeof jsonSchema !== 'string')
      return JSON.stringify(jsonSchema, null, 2)

    return jsonSchema
  }
  catch {
    return ''
  }
}

export const isJsonSchemaEmpty = (value: InputVar['json_schema']) => {
  if (value === null || value === undefined)
    return true
  if (typeof value !== 'string')
    return false
  return value.trim() === ''
}

export const updatePayloadField = (payload: InputVar, key: string, value: unknown) => {
  const nextPayload = {
    ...payload,
    [key]: value,
  } as InputVar

  if (key === 'options' && payload.default) {
    const options = Array.isArray(value) ? value : []
    if (!options.includes(payload.default))
      nextPayload.default = undefined
  }

  return nextPayload
}

export const createPayloadForType = (payload: InputVar, type: InputVarType) => {
  return produce(payload, (draft) => {
    draft.type = type
    if (type === InputVarType.select)
      draft.default = undefined

    if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type)) {
      (Object.keys(DEFAULT_FILE_UPLOAD_SETTING) as Array<keyof typeof DEFAULT_FILE_UPLOAD_SETTING>).forEach((key) => {
        if (key !== 'max_length')
          draft[key] = DEFAULT_FILE_UPLOAD_SETTING[key] as never
      })

      if (type === InputVarType.multiFiles)
        draft.max_length = DEFAULT_FILE_UPLOAD_SETTING.max_length
    }
  })
}

export const buildSelectOptions = ({
  isBasicApp,
  supportFile,
  t,
}: {
  isBasicApp: boolean
  supportFile?: boolean
  t: Translate
}): SelectItem[] => {
  return [
    {
      name: t('variableConfig.text-input', { ns: 'appDebug' }),
      value: InputVarType.textInput,
    },
    {
      name: t('variableConfig.paragraph', { ns: 'appDebug' }),
      value: InputVarType.paragraph,
    },
    {
      name: t('variableConfig.select', { ns: 'appDebug' }),
      value: InputVarType.select,
    },
    {
      name: t('variableConfig.number', { ns: 'appDebug' }),
      value: InputVarType.number,
    },
    {
      name: t('variableConfig.checkbox', { ns: 'appDebug' }),
      value: InputVarType.checkbox,
    },
    ...(supportFile
      ? [
          {
            name: t('variableConfig.single-file', { ns: 'appDebug' }),
            value: InputVarType.singleFile,
          },
          {
            name: t('variableConfig.multi-files', { ns: 'appDebug' }),
            value: InputVarType.multiFiles,
          },
        ]
      : []),
    ...(!isBasicApp
      ? [
          {
            name: t('variableConfig.json', { ns: 'appDebug' }),
            value: InputVarType.jsonObject,
          },
        ]
      : []),
  ]
}

export const validateConfigModalPayload = ({
  tempPayload,
  payload,
  checkVariableName,
  t,
}: ValidateConfigModalPayloadOptions): ValidateConfigModalPayloadResult => {
  const jsonSchemaValue = tempPayload.json_schema
  const schemaEmpty = isJsonSchemaEmpty(jsonSchemaValue)
  const normalizedJsonSchema = schemaEmpty ? undefined : jsonSchemaValue
  const payloadToSave = tempPayload.type === InputVarType.jsonObject && schemaEmpty
    ? { ...tempPayload, json_schema: undefined }
    : tempPayload

  const moreInfo = tempPayload.variable === payload?.variable
    ? undefined
    : {
        type: ChangeType.changeVarName,
        payload: { beforeKey: payload?.variable || '', afterKey: tempPayload.variable },
      }

  if (!checkVariableName(tempPayload.variable))
    return {}

  if (!tempPayload.label) {
    return {
      errorMessage: t('variableConfig.errorMsg.labelNameRequired', { ns: 'appDebug' }),
    }
  }

  if (tempPayload.type === InputVarType.select) {
    if (!tempPayload.options?.length) {
      return {
        errorMessage: t('variableConfig.errorMsg.atLeastOneOption', { ns: 'appDebug' }),
      }
    }

    const duplicated = new Set<string>()
    const hasRepeatedItem = tempPayload.options.some((option) => {
      if (duplicated.has(option))
        return true

      duplicated.add(option)
      return false
    })

    if (hasRepeatedItem) {
      return {
        errorMessage: t('variableConfig.errorMsg.optionRepeat', { ns: 'appDebug' }),
      }
    }
  }

  if ([InputVarType.singleFile, InputVarType.multiFiles].includes(tempPayload.type)) {
    if (!tempPayload.allowed_file_types?.length) {
      return {
        errorMessage: t('errorMsg.fieldRequired', {
          ns: 'workflow',
          field: t('variableConfig.file.supportFileTypes', { ns: 'appDebug' }),
        }),
      }
    }

    if (tempPayload.allowed_file_types.includes(SupportUploadFileTypes.custom) && !tempPayload.allowed_file_extensions?.length) {
      return {
        errorMessage: t('errorMsg.fieldRequired', {
          ns: 'workflow',
          field: t('variableConfig.file.custom.name', { ns: 'appDebug' }),
        }),
      }
    }
  }

  if (tempPayload.type === InputVarType.jsonObject && !schemaEmpty && typeof normalizedJsonSchema === 'string') {
    try {
      const schema = JSON.parse(normalizedJsonSchema)
      if (schema?.type !== 'object') {
        return {
          errorMessage: t('variableConfig.errorMsg.jsonSchemaMustBeObject', { ns: 'appDebug' }),
        }
      }
    }
    catch {
      return {
        errorMessage: t('variableConfig.errorMsg.jsonSchemaInvalid', { ns: 'appDebug' }),
      }
    }
  }

  return {
    payloadToSave,
    moreInfo,
  }
}
