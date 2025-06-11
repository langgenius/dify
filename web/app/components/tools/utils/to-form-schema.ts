import type { ToolCredential, ToolParameter } from '../types'
export const toType = (type: string) => {
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
      _type: parameter.type,
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

export const addDefaultValue = (value: Record<string, any>, formSchemas: { variable: string; type: string; default?: any }[]) => {
  const newValues = { ...value }
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined))
      newValues[formSchema.variable] = formSchema.default
  })
  return newValues
}

const correctInitialData = (type: string, target: any, defaultValue: any) => {
  if (type === 'text-input' || type === 'secret-input')
    target.type = 'mixed'

  if (type === 'boolean') {
    if (typeof defaultValue === 'string')
      target.value = defaultValue === 'true' || defaultValue === '1'

    if (typeof defaultValue === 'boolean')
      target.value = defaultValue

    if (typeof defaultValue === 'number')
      target.value = defaultValue === 1
  }

  if (type === 'number-input') {
    if (typeof defaultValue === 'string' && defaultValue !== '')
      target.value = Number.parseFloat(defaultValue)
  }

  if (type === 'app-selector' || type === 'model-selector')
    target.value = defaultValue

  return target
}

export const generateFormValue = (value: Record<string, any>, formSchemas: { variable: string; default?: any; type: string }[], isReasoning = false) => {
  const newValues = {} as any
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined)) {
      const value = formSchema.default
      newValues[formSchema.variable] = {
        value: {
          type: 'constant',
          value: formSchema.default,
        },
        ...(isReasoning ? { auto: 1, value: null } : {}),
      }
      if (!isReasoning)
        newValues[formSchema.variable].value = correctInitialData(formSchema.type, newValues[formSchema.variable].value, value)
    }
  })
  return newValues
}

export const getConfiguredValue = (value: Record<string, any>, formSchemas: { variable: string; type: string; default?: any }[]) => {
  const newValues = { ...value }
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined)) {
      const value = formSchema.default
      newValues[formSchema.variable] = {
        type: 'constant',
        value: formSchema.default,
      }
      newValues[formSchema.variable] = correctInitialData(formSchema.type, newValues[formSchema.variable], value)
    }
  })
  return newValues
}
