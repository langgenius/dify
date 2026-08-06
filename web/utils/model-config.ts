import type { PromptVariable } from '@/models/debug'
import type { UserInputFormItem } from '@/types/app'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getString = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

const getOptionalString = (value: unknown) => {
  return typeof value === 'string' ? value : undefined
}

const getBoolean = (value: unknown, fallback = false) => {
  return typeof value === 'boolean' ? value : fallback
}

const getNumber = (value: unknown) => {
  return typeof value === 'number' ? value : undefined
}

const getDefaultValue = (value: unknown) => {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

const getStringArray = (value: unknown) => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

const getStringRecord = (value: unknown) => {
  if (!isRecord(value)) return undefined

  const record: Record<string, string | undefined> = {}
  Object.entries(value).forEach(([key, item]) => {
    if (typeof item === 'string') record[key] = item
  })
  return record
}

const getRecord = (value: unknown) => {
  return isRecord(value) ? value : {}
}

const getInputFormContent = (item: Record<string, unknown>) => {
  if (isRecord(item.paragraph)) return { type: 'paragraph', content: item.paragraph }

  if (isRecord(item['text-input'])) return { type: 'string', content: item['text-input'] }

  if (isRecord(item.number)) return { type: 'number', content: item.number }

  if (isRecord(item.checkbox)) return { type: 'boolean', content: item.checkbox }

  if (isRecord(item.file)) return { type: 'file', content: item.file }

  if (isRecord(item['file-list'])) return { type: 'file-list', content: item['file-list'] }

  if (isRecord(item.external_data_tool))
    return { type: getString(item.external_data_tool.type), content: item.external_data_tool }

  if (isRecord(item.json_object)) return { type: 'json_object', content: item.json_object }

  return { type: 'select', content: getRecord(item.select) }
}

export const userInputsFormToPromptVariables = (
  useInputs: Record<string, unknown>[] | null,
  dataset_query_variable?: string,
) => {
  if (!useInputs) return []
  const promptVariables: PromptVariable[] = []
  useInputs.forEach((item) => {
    const { type, content } = getInputFormContent(item)
    const variable = getString(content.variable)
    const is_context_var = dataset_query_variable === variable

    if (type === 'string' || type === 'paragraph') {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type,
        max_length: getNumber(content.max_length),
        options: [],
        is_context_var,
        hide: getBoolean(content.hide),
        default: getDefaultValue(content.default),
      })
    } else if (type === 'number') {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type,
        options: [],
        hide: getBoolean(content.hide),
        default: getDefaultValue(content.default),
      })
    } else if (type === 'boolean') {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type: 'checkbox',
        options: [],
        hide: getBoolean(content.hide),
        default: getDefaultValue(content.default),
      })
    } else if (type === 'select') {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type: 'select',
        options: getStringArray(content.options),
        is_context_var,
        hide: getBoolean(content.hide),
        default: getDefaultValue(content.default),
      })
    } else if (type === 'file') {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type,
        config: {
          allowed_file_types: content.allowed_file_types,
          allowed_file_extensions: content.allowed_file_extensions,
          allowed_file_upload_methods: content.allowed_file_upload_methods,
          number_limits: 1,
        },
        hide: getBoolean(content.hide),
        default: getDefaultValue(content.default),
      })
    } else if (type === 'file-list') {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type,
        config: {
          allowed_file_types: content.allowed_file_types,
          allowed_file_extensions: content.allowed_file_extensions,
          allowed_file_upload_methods: content.allowed_file_upload_methods,
          number_limits: getNumber(content.max_length),
        },
        hide: getBoolean(content.hide),
        default: getDefaultValue(content.default),
      })
    } else {
      promptVariables.push({
        key: variable,
        name: getString(content.label),
        required: getBoolean(content.required, true),
        type: getString(content.type || type),
        enabled: getBoolean(content.enabled),
        config: getRecord(content.config),
        icon: getOptionalString(content.icon),
        icon_background: getOptionalString(content.icon_background),
        is_context_var,
        hide: getBoolean(content.hide),
      })
    }
  })
  return promptVariables
}

export const promptVariablesToUserInputsForm = (promptVariables: PromptVariable[]) => {
  const userInputs: UserInputFormItem[] = []
  promptVariables
    .filter(({ key, name }) => {
      return key && key.trim() && name && name.trim()
    })
    .forEach((item) => {
      if (item.type === 'string') {
        userInputs.push({
          'text-input': {
            label: item.name,
            variable: item.key,
            required: item.required !== false, // default true
            max_length: item.max_length,
            default: '',
            hide: item.hide,
          },
        })
        return
      }
      if (item.type === 'paragraph') {
        userInputs.push({
          paragraph: {
            label: item.name,
            variable: item.key,
            required: item.required !== false, // default true
            max_length: item.max_length,
            default: '',
            hide: item.hide,
          },
        })
        return
      }
      if (item.type === 'number') {
        userInputs.push({
          number: {
            label: item.name,
            variable: item.key,
            required: item.required !== false, // default true
            default: '',
            hide: item.hide,
          },
        })
      } else if (item.type === 'checkbox') {
        userInputs.push({
          checkbox: {
            label: item.name,
            variable: item.key,
            required: item.required !== false, // default true
            default: '',
            hide: item.hide,
          },
        })
      } else if (item.type === 'select') {
        userInputs.push({
          select: {
            label: item.name,
            variable: item.key,
            required: item.required !== false, // default true
            options: item.options,
            default: getString(item.default),
            hide: item.hide,
          },
        })
      } else {
        userInputs.push({
          external_data_tool: {
            label: item.name,
            variable: item.key,
            enabled: item.enabled,
            type: item.type,
            config: getStringRecord(item.config),
            required: item.required,
            icon: item.icon,
            icon_background: item.icon_background,
            hide: item.hide,
          },
        })
      }
    })

  return userInputs
}

export const formatBooleanInputs = (
  useInputs?: PromptVariable[] | null,
  inputs?: Record<string, string | number | object | boolean | null> | null,
) => {
  if (!useInputs) return inputs
  const res = { ...inputs }
  useInputs.forEach((item) => {
    const isBooleanInput = item.type === 'checkbox'
    if (isBooleanInput) {
      // Convert boolean inputs to boolean type
      res[item.key] = !!res[item.key]
    }
  })
  return res
}
