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

      if (item.external_data_tool)
        return [item.external_data_tool.type, item.external_data_tool]

      return ['select', item.select]
    })()
    const is_context_var = dataset_query_variable === content.variable

    if (type === 'string' || type === 'paragraph') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type,
        max_length: content.max_length,
        options: [],
        is_context_var,
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
      })
    }
  })
  return promptVariables
}

export const promptVariablesToUserInputsForm = (promptVariables: PromptVariable[]) => {
  const userInputs: UserInputFormItem[] = []
  promptVariables.filter(({ key, name }) => {
    if (key && key.trim() && name && name.trim())
      return true

    return false
  }).forEach((item: any) => {
    if (item.type === 'string' || item.type === 'paragraph') {
      userInputs.push({
        [item.type === 'string' ? 'text-input' : 'paragraph']: {
          label: item.name,
          variable: item.key,
          required: item.required !== false, // default true
          max_length: item.max_length,
          default: '',
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
          default: '',
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
        },
      } as any)
    }
  })
  return userInputs
}
