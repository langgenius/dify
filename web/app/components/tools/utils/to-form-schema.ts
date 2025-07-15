import type { ToolCredential, ToolParameter } from '../types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

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

export const getPlainValue = (value: Record<string, any>) => {
  const plainValue = { ...value }
  Object.keys(plainValue).forEach((key) => {
    plainValue[key] = {
      ...value[key].value,
    }
  })
  return plainValue
}

export const getStructureValue = (value: Record<string, any>) => {
  const newValue = { ...value } as any
  Object.keys(newValue).forEach((key) => {
    newValue[key] = {
      value: value[key],
    }
  })
  return newValue
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

const getVarKindType = (type: FormTypeEnum) => {
    if (type === FormTypeEnum.file || type === FormTypeEnum.files)
      return VarKindType.variable
    if (type === FormTypeEnum.select || type === FormTypeEnum.boolean || type === FormTypeEnum.textNumber)
      return VarKindType.constant
    if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
      return VarKindType.mixed
  }

export const generateAgentToolValue = (value: Record<string, any>, formSchemas: { variable: string; default?: any; type: string }[], isReasoning = false) => {
  const newValues = {} as any
  if (!isReasoning) {
    formSchemas.forEach((formSchema) => {
      const itemValue = value[formSchema.variable]
      newValues[formSchema.variable] = {
        value: {
          type: 'constant',
          value: itemValue.value,
        },
      }
      newValues[formSchema.variable].value = correctInitialData(formSchema.type, newValues[formSchema.variable].value, itemValue.value)
    })
  }
  else {
    formSchemas.forEach((formSchema) => {
      const itemValue = value[formSchema.variable]
      if (itemValue.auto === 1) {
        newValues[formSchema.variable] = {
          auto: 1,
          value: null,
        }
      }
      else {
        newValues[formSchema.variable] = {
          auto: 0,
          value: itemValue.value || {
            type: getVarKindType(formSchema.type as FormTypeEnum),
            value: null,
          },
        }
      }
    })
  }
  return newValues
}
