import type { TriggerEventParameter } from '../../plugins/types'
import type { ToolCredential, ToolParameter, ToolParameterShowOnCondition } from '../types'
import type { TypeWithI18N } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'

// Type for form value input with type and value properties
type FormValueInput = {
  type?: string
  value?: unknown
}

type ToolFormOption = {
  label: TypeWithI18N
  value: string
  show_on: ToolParameterShowOnCondition[]
  children?: ToolFormOption[]
}

/**
 * Form schema type for tool credentials.
 * This type represents the schema returned by toolCredentialToFormSchemas.
 */
export type ToolCredentialFormSchema = {
  name: string
  variable: string
  label: TypeWithI18N
  type: string
  required: boolean
  default?: string
  tooltip?: TypeWithI18N
  placeholder?: TypeWithI18N
  show_on: ToolParameterShowOnCondition[]
  options?: ToolFormOption[]
  help?: TypeWithI18N | null
  url?: string
}

/**
 * Form schema type for tool parameters.
 * This type represents the schema returned by toolParametersToFormSchemas.
 */
export type ToolFormSchema = {
  name: string
  variable: string
  label: TypeWithI18N
  type: string
  _type: string
  form: string
  required: boolean
  default?: string
  tooltip?: TypeWithI18N
  show_on: ToolParameterShowOnCondition[]
  options?: ToolFormOption[]
  placeholder?: TypeWithI18N
  min?: number
  max?: number
  llm_description?: string
  human_description?: TypeWithI18N
  multiple?: boolean
  url?: string
  scope?: string
  input_schema?: SchemaRoot
}

export const toType = (type: string) => {
  switch (type) {
    case 'string':
      return 'text-input'
    case 'number':
      return 'number-input'
    case 'boolean':
      return 'checkbox'
    default:
      return type
  }
}

export const triggerEventParametersToFormSchemas = (parameters: TriggerEventParameter[]) => {
  if (!parameters?.length)
    return []

  return parameters.map((parameter) => {
    return {
      ...parameter,
      type: toType(parameter.type),
      _type: parameter.type,
      tooltip: parameter.description,
    }
  })
}

export const toolParametersToFormSchemas = (parameters: ToolParameter[]): ToolFormSchema[] => {
  if (!parameters)
    return []

  const formSchemas = parameters.map((parameter): ToolFormSchema => {
    return {
      ...parameter,
      variable: parameter.name,
      type: toType(parameter.type),
      _type: parameter.type,
      show_on: parameter.show_on ?? [],
      options: parameter.options?.map((option) => {
        return {
          ...option,
          show_on: option.show_on ?? [],
        }
      }),
      tooltip: parameter.human_description,
    }
  })
  return formSchemas
}

export const toolCredentialToFormSchemas = (parameters: ToolCredential[]): ToolCredentialFormSchema[] => {
  if (!parameters)
    return []

  const formSchemas = parameters.map((parameter): ToolCredentialFormSchema => {
    return {
      ...parameter,
      variable: parameter.name,
      type: toType(parameter.type),
      label: parameter.label,
      tooltip: parameter.help ?? undefined,
      show_on: parameter.show_on ?? [],
      options: parameter.options?.map((option) => {
        return {
          ...option,
          show_on: option.show_on ?? [],
        }
      }),
    }
  })
  return formSchemas
}

export const addDefaultValue = (value: Record<string, unknown>, formSchemas: { variable: string, type: string, default?: unknown }[]) => {
  const newValues = { ...value }
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined))
      newValues[formSchema.variable] = formSchema.default

    // Fix: Convert boolean field values to proper boolean type
    if (formSchema.type === 'boolean' && itemValue !== undefined && itemValue !== null && itemValue !== '') {
      if (typeof itemValue === 'string')
        newValues[formSchema.variable] = itemValue === 'true' || itemValue === '1' || itemValue === 'True'
      else if (typeof itemValue === 'number')
        newValues[formSchema.variable] = itemValue === 1
      else if (typeof itemValue === 'boolean')
        newValues[formSchema.variable] = itemValue
    }
  })
  return newValues
}

const correctInitialData = (type: string, target: FormValueInput, defaultValue: unknown): FormValueInput => {
  if (type === 'text-input' || type === 'secret-input')
    target.type = 'mixed'

  if (type === 'boolean' || type === FormTypeEnum.checkbox) {
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

/**
 * Reset one workflow tool-setting input entry to `schema.default`, matching {@link getConfiguredValue} / panel conventions.
 */
export function resetToolSettingFieldValue(schema: {
  type: string
  default?: string
}): ResourceVarInputs[string] {
  const defaultSource = schema.default
  const initialValue: FormValueInput = {
    type: 'constant',
    value:
      typeof defaultSource === 'string'
        ? defaultSource.replace(/\n/g, '\\n')
        : defaultSource,
  }
  const corrected = correctInitialData(schema.type, initialValue, defaultSource)
  const outerType
    = corrected.type === VarKindType.variable
      ? VarKindType.variable
      : corrected.type === VarKindType.mixed
        ? VarKindType.mixed
        : VarKindType.constant
  return {
    type: outerType,
    value: corrected.value,
  }
}

export const generateFormValue = (value: Record<string, unknown>, formSchemas: { variable: string, default?: unknown, type: string }[], isReasoning = false) => {
  const newValues: Record<string, unknown> = {}
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined)) {
      const defaultVal = formSchema.default
      if (isReasoning) {
        newValues[formSchema.variable] = { auto: 1, value: null }
      }
      else {
        const initialValue: FormValueInput = { type: 'constant', value: formSchema.default }
        newValues[formSchema.variable] = {
          value: correctInitialData(formSchema.type, initialValue, defaultVal),
        }
      }
    }
  })
  return newValues
}

/**
 * Normalize one tool-setting field from persisted `ToolValue.settings` / `generateFormValue` shape
 * into {@link ResourceVarInputs} entries for `ToolForm` / `show_on` checks.
 *
 * Supports:
 * - Nested `{ value: FormValueInput }` from {@link generateFormValue}
 * - Flat `{ type, value }` from workflow `getConfiguredValue` / node storage
 * - Legacy primitives (string / number / boolean) as constant inputs
 */
export function flattenToolSettingStoredEntry(stored: unknown): ResourceVarInputs[string] | undefined {
  if (stored === null || stored === undefined)
    return undefined
  if (typeof stored === 'string' || typeof stored === 'number' || typeof stored === 'boolean')
    return { type: VarKindType.constant, value: stored }
  if (typeof stored !== 'object')
    return undefined
  const row = stored as Record<string, unknown>
  if (
    'value' in row
    && row.value !== null
    && typeof row.value === 'object'
    && 'type' in (row.value as object)
  ) {
    const inner = row.value as { type: string, value?: unknown }
    const outerType
      = inner.type === VarKindType.variable
        ? VarKindType.variable
        : inner.type === VarKindType.mixed
          ? VarKindType.mixed
          : VarKindType.constant
    return { type: outerType, value: inner.value }
  }
  if ('value' in row && !('type' in row)) {
    const only = row.value
    if (typeof only === 'string' || typeof only === 'number' || typeof only === 'boolean')
      return { type: VarKindType.constant, value: only }
  }
  if ('type' in row) {
    return {
      type: row.type as VarKindType,
      value: 'value' in row ? row.value : undefined,
    }
  }
  return undefined
}

export const getPlainValue = (value: Record<string, { value: unknown }>) => {
  const plainValue: Record<string, unknown> = {}
  Object.keys(value).forEach((key) => {
    const normalized = flattenToolSettingStoredEntry(value[key])
    if (normalized)
      plainValue[key] = normalized
  })
  return plainValue as ResourceVarInputs
}

export const getStructureValue = (value: Record<string, unknown>): Record<string, { value: unknown }> => {
  const newValue: Record<string, { value: unknown }> = {}
  Object.keys(value).forEach((key) => {
    newValue[key] = {
      value: value[key],
    }
  })
  return newValue
}

export const getConfiguredValue = (value: Record<string, unknown>, formSchemas: { variable: string, type: string, default?: unknown }[]) => {
  const newValues: Record<string, unknown> = { ...value }
  formSchemas.forEach((formSchema) => {
    const itemValue = value[formSchema.variable]
    if ((formSchema.default !== undefined) && (value === undefined || itemValue === null || itemValue === '' || itemValue === undefined)) {
      const defaultVal = formSchema.default
      const initialValue: FormValueInput = {
        type: 'constant',
        value: typeof formSchema.default === 'string' ? formSchema.default.replace(/\n/g, '\\n') : formSchema.default,
      }
      newValues[formSchema.variable] = correctInitialData(formSchema.type, initialValue, defaultVal)
    }
  })
  return newValues
}

const getVarKindType = (type: FormTypeEnum) => {
  if (type === FormTypeEnum.file || type === FormTypeEnum.files)
    return VarKindType.variable
  if (type === FormTypeEnum.select || type === FormTypeEnum.checkbox || type === FormTypeEnum.textNumber)
    return VarKindType.constant
  if (type === FormTypeEnum.textInput || type === FormTypeEnum.secretInput)
    return VarKindType.mixed
}

export const generateAgentToolValue = (value: Record<string, { value?: unknown, auto?: 0 | 1 }>, formSchemas: { variable: string, default?: unknown, type: string }[], isReasoning = false) => {
  const newValues: Record<string, { value: FormValueInput | null, auto?: 0 | 1 }> = {}
  if (!isReasoning) {
    formSchemas.forEach((formSchema) => {
      const itemValue = value[formSchema.variable]
      newValues[formSchema.variable] = {
        value: {
          type: 'constant',
          value: itemValue?.value,
        },
      }
      newValues[formSchema.variable]!.value = correctInitialData(formSchema.type, newValues[formSchema.variable]!.value!, itemValue?.value)
    })
  }
  else {
    formSchemas.forEach((formSchema) => {
      const itemValue = value[formSchema.variable]
      if (itemValue?.auto === 1) {
        newValues[formSchema.variable] = {
          auto: 1,
          value: null,
        }
      }
      else {
        newValues[formSchema.variable] = {
          auto: 0,
          value: (itemValue?.value as FormValueInput) || {
            type: getVarKindType(formSchema.type as FormTypeEnum),
            value: null,
          },
        }
      }
    })
  }
  return newValues
}
