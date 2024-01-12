import type { ToolCredential, ToolParameter } from '../types'
export const toolParametersToFormSchemas = (parameters: ToolParameter[]) => {
  if (!parameters)
    return []

  const formSchemas = parameters.map((parameter) => {
    return {
      ...parameter,
      variable: parameter.name,
      type: parameter.type === 'string' ? 'text-input' : parameter.type,
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

export const toolCredentialToFormSchemas = (parameters: ToolCredential[]) => {
  if (!parameters)
    return []

  const formSchemas = parameters.map((parameter) => {
    return {
      ...parameter,
      variable: parameter.name,
      label: {
        en_US: parameter.name,
        zh_Hans: parameter.name,
      },
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
