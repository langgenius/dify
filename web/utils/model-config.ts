import { UserInputFormItem, } from '@/types/app'
import { PromptVariable } from '@/models/debug'

export const userInputsFormToPromptVariables = (useInputs: UserInputFormItem[] | null) => {
  if (!useInputs) return []
  const promptVariables: PromptVariable[] = []
  useInputs.forEach((item: any) => {
    const type = item['text-input'] ? 'string' : 'select'
    const content = type === 'string' ? item['text-input'] : item['select']
    if (type === 'string') {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type: 'string',
        max_length: content.max_length,
        options: [],
      })
    } else {
      promptVariables.push({
        key: content.variable,
        name: content.label,
        required: content.required,
        type: 'select',
        options: content.options,
      })
    }
  })
  return promptVariables
}

export const promptVariablesToUserInputsForm = (promptVariables: PromptVariable[]) => {
  const userInputs: UserInputFormItem[] = []
  promptVariables.filter(({ key, name }) => {
    if (key && key.trim() && name && name.trim()) {
      return true
    }
    return false
  }).forEach((item: any) => {
    if (item.type === 'string') {
      userInputs.push({
        'text-input': {
          label: item.name,
          variable: item.key,
          required: item.required === false ? false : true, // default true
          max_length: item.max_length,
          default: ''
        },
      } as any)
    } else {
      userInputs.push({
        'select': {
          label: item.name,
          variable: item.key,
          required: item.required === false ? false : true, // default true
          options: item.options,
          default: ''
        },
      } as any)
    }
  })
  return userInputs
}
