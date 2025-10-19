import type { UserInputFormItem } from '@/types/app'
import type { PromptVariable } from '@/models/debug'

export const userInputsFormToPromptVariables = (useInputs: UserInputFormItem[] | null, dataset_query_variable?: string) => {
  if (!useInputs)
    return []
  const promptVariables: PromptVariable[] = []
  useInputs.forEach((item: any) => {
    const isParagraph = !!item.paragraph

    const [type, content] = (() => {
      if (isParagraph)
        return ['paragraph', item.paragraph]

      if (item['text-input'])
        return ['string', item['text-input']]

      if (item.number)
        return ['number', item.number]

      if (item.checkbox)
        return ['boolean', item.checkbox]

      if (item.file)
        return ['file', item.file]

      if (item['file-list'])
        return ['file-list', item['file-list']]

      if (item.external_data_tool)
        return [item.external_data_tool.type, item.external_data_tool]

      if (item.json_object)
        return ['json_object', item.json_object]

      return ['select', item.select || {}]
    })()
    const is_context_var = dataset_query_variable === content?.variable

    if (type === 'string' || type === 'paragraph') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        max_length: content.max_length,
        options: [],
        is_context_var,
        hide: content.hide,
        default: content.default,
      })
    }
    else if (type === 'number') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        options: [],
        hide: content.hide,
        default: content.default,
      })
    }
    else if (type === 'boolean') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type: 'checkbox',
        options: [],
        hide: content.hide,
        default: content.default,
      })
    }
    else if (type === 'select') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type: 'select',
        options: content.options,
        is_context_var,
        hide: content.hide,
        default: content.default,
      })
    }
    else if (type === 'file') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        config: {
          allowed_file_types: content.allowed_file_types,
          allowed_file_extensions: content.allowed_file_extensions,
          allowed_file_upload_methods: content.allowed_file_upload_methods,
          number_limits: 1,
        },
        hide: content.hide,
        default: content.default,
      })
    }
    else if (type === 'file-list') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        config: {
          allowed_file_types: content.allowed_file_types,
          allowed_file_extensions: content.allowed_file_extensions,
          allowed_file_upload_methods: content.allowed_file_upload_methods,
          number_limits: content.max_length,
        },
        hide: content.hide,
        default: content.default,
      })
    }
    else {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type: content.type,
        enabled: content.enabled,
        config: content.config,
        icon: content.icon,
        icon_background: content.icon_background,
        is_context_var,
        hide: content.hide,
      })
    }
  })
  return promptVariables
}

export const promptVariablesToUserInputsForm = (promptVariables: PromptVariable[]) => {
  const userInputs: UserInputFormItem[] = []
  promptVariables.filter(({ key, name }) => {
    return key && key.trim() && name && name.trim()
  }).forEach((item: any) => {
    if (item.type === 'string' || item.type === 'paragraph') {
      userInputs.push({
        [item.type === 'string' ? 'text-input' : 'paragraph']: {
          label: item.name,
          variable: item.key,
          required: item.required !== false, // default true
          max_length: item.max_length,
          default: '',
          hide: item.hide,
        },
      } as any)
      return
    }
    if (item.type === 'number' || item.type === 'checkbox') {
      userInputs.push({
        [item.type]: {
          label: item.name,
          variable: item.key,
          required: item.required !== false, // default true
          default: '',
          hide: item.hide,
        },
      } as any)
    }
    else if (item.type === 'select') {
      userInputs.push({
        select: {
          label: item.name,
          variable: item.key,
          required: item.required !== false, // default true
          options: item.options,
          default: item.default ?? '',
          hide: item.hide,
        },
      } as any)
    }
    else {
      userInputs.push({
        external_data_tool: {
          label: item.name,
          variable: item.key,
          enabled: item.enabled,
          type: item.type,
          config: item.config,
          required: item.required,
          icon: item.icon,
          icon_background: item.icon_background,
          hide: item.hide,
        },
      } as any)
    }
  })

  return userInputs
}

export const formatBooleanInputs = (useInputs?: PromptVariable[] | null, inputs?: Record<string, string | number | object | boolean> | null) => {
  if(!useInputs)
    return inputs
  const res = { ...inputs }
  useInputs.forEach((item) => {
    const isBooleanInput = item.type === 'boolean'
    if (isBooleanInput) {
      // Convert boolean inputs to boolean type
      res[item.key] = !!res[item.key]
    }
  })
  return res
}
