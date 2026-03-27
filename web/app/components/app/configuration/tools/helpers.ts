import type {
  CodeBasedExtensionItem,
  ExternalDataTool,
} from '@/models/common'
import { LanguagesSupported } from '@/i18n-config/language'

export const SYSTEM_EXTERNAL_DATA_TOOL_TYPES = ['api'] as const

export type ExternalDataToolProvider = {
  key: string
  name: string
  form_schema?: CodeBasedExtensionItem['form_schema']
}

type PromptVariableLike = {
  key: string
}

type ExternalDataToolValidationError = {
  kind: 'required' | 'invalid'
  label: string
}

const isSystemExternalDataToolType = (type?: string) => (
  !!type && SYSTEM_EXTERNAL_DATA_TOOL_TYPES.includes(type as typeof SYSTEM_EXTERNAL_DATA_TOOL_TYPES[number])
)

const getLocalizedLabel = (
  label: Record<string, string> | undefined,
  locale: string,
) => {
  if (!label)
    return ''

  if (locale === LanguagesSupported[1])
    return label['zh-Hans'] || label['en-US'] || ''

  return label['en-US'] || label['zh-Hans'] || ''
}

export const getInitialExternalDataTool = (data: ExternalDataTool): ExternalDataTool => (
  data.type ? data : { ...data, type: 'api' }
)

export const getExternalDataToolDefaultConfig = (
  type: string,
  providers: ExternalDataToolProvider[],
) => {
  const provider = providers.find(item => item.key === type)
  if (isSystemExternalDataToolType(type) || !provider?.form_schema)
    return undefined

  return provider.form_schema.reduce<Record<string, unknown>>((acc, field) => {
    acc[field.variable] = field.default
    return acc
  }, {})
}

export const upsertExternalDataTool = (
  externalDataTools: ExternalDataTool[],
  externalDataTool: ExternalDataTool,
  index: number,
) => {
  if (index > -1) {
    return [
      ...externalDataTools.slice(0, index),
      externalDataTool,
      ...externalDataTools.slice(index + 1),
    ]
  }

  return [...externalDataTools, externalDataTool]
}

export const removeExternalDataTool = (
  externalDataTools: ExternalDataTool[],
  index: number,
) => {
  return [
    ...externalDataTools.slice(0, index),
    ...externalDataTools.slice(index + 1),
  ]
}

export const findExternalDataToolVariableConflict = (
  variable: string | undefined,
  externalDataTools: ExternalDataTool[],
  promptVariables: PromptVariableLike[],
  index: number,
) => {
  if (!variable)
    return undefined

  const promptVariable = promptVariables.find(item => item.key === variable)
  if (promptVariable)
    return promptVariable.key

  return externalDataTools
    .filter((_item, toolIndex) => toolIndex !== index)
    .find(item => item.variable === variable)
    ?.variable
}

export const formatExternalDataToolForSave = (
  originData: ExternalDataTool,
  currentProvider: ExternalDataToolProvider | undefined,
  fallbackEnabled: boolean,
) => {
  const { type, config } = originData
  const params: Record<string, unknown> = {}

  if (type === 'api')
    params.api_based_extension_id = config?.api_based_extension_id

  if (!isSystemExternalDataToolType(type) && currentProvider?.form_schema) {
    currentProvider.form_schema.forEach((field) => {
      params[field.variable] = config?.[field.variable]
    })
  }

  return {
    ...originData,
    type,
    enabled: fallbackEnabled,
    config: params,
  }
}

export const getExternalDataToolValidationError = ({
  localeData,
  currentProvider,
  locale,
}: {
  localeData: ExternalDataTool
  currentProvider?: ExternalDataToolProvider
  locale: string
}): ExternalDataToolValidationError | null => {
  if (!localeData.type) {
    return {
      kind: 'required',
      label: 'feature.tools.modal.toolType.title',
    }
  }

  if (!localeData.label) {
    return {
      kind: 'required',
      label: 'feature.tools.modal.name.title',
    }
  }

  if (!localeData.variable) {
    return {
      kind: 'required',
      label: 'feature.tools.modal.variableName.title',
    }
  }

  if (!/^[a-z_]\w{0,29}$/i.test(localeData.variable)) {
    return {
      kind: 'invalid',
      label: 'feature.tools.modal.variableName.title',
    }
  }

  if (localeData.type === 'api' && !localeData.config?.api_based_extension_id) {
    return {
      kind: 'required',
      label: locale === LanguagesSupported[1] ? 'API 扩展' : 'API Extension',
    }
  }

  if (!isSystemExternalDataToolType(localeData.type) && currentProvider?.form_schema) {
    const requiredField = currentProvider.form_schema.find(field => !localeData.config?.[field.variable] && field.required)
    if (requiredField) {
      return {
        kind: 'required',
        label: getLocalizedLabel(requiredField.label, locale),
      }
    }
  }

  return null
}
