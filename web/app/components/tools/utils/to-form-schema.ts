import type { ToolCredential, ToolParameter } from '../types'
const toType = (type: string) => {
  switch (type) {
    case 'string':
      return 'text-input'
    case 'number':
      return 'number-input'
    default:
      return type
  }
}
export const toolParametersToFormSchemas = (parameters: ToolParameter[]) => {
  if (!parameters)
    return []

  const formSchemas = parameters.map((parameter) => {
    return {
      ...parameter,
      variable: parameter.name,
      type: toType(parameter.type),
      show_on: [],
      options: parameter.options?.map((option) => {
        return {
          ...option,
          show_on: [],
        }
      }),
      tooltip: parameter.human_description,
    }
  })
  return formSchemas
}

export const toolCredentialToFormSchemas = (parameters: ToolCredential[]) => {
  if (!parameters)
    return []

  const formSchemas = parameters.map((parameter) => {
    return {
      ...parameter,
      variable: parameter.name,
      label: parameter.label,
      tooltip: parameter.help,
      show_on: [],
      options: parameter.options?.map((option) => {
        return {
          ...option,
          show_on: [],
        }
      }),
    }
  })
  return formSchemas
}

export const addDefaultValue = (value: Record<string, any>, formSchemas: { variable: string; default?: any }[]) => {
  const newValues = { ...value }
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined))
      newValues[formSchema.variable] = formSchema.default
  })
  return newValues
}
