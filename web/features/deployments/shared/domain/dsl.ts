import { AppModeEnum } from '@/types/app'
import { loadYaml } from '@/utils/yaml'

export type DslEnvVarSlot = {
  key: string
  description?: string
  defaultValue?: string
  hasDefaultValue?: boolean
  valueType?: string
}

type DslMetadata = {
  app?: {
    mode?: unknown
    name?: unknown
  }
  workflow?: {
    environment_variables?: unknown
  }
}

type DslEnvVarRecord = Record<string, unknown>

const ENV_VAR_DEFAULT_VALUE_FIELDS = ['value', 'default_value', 'defaultValue', 'default'] as const
const ENV_VAR_VALUE_TYPE_FIELDS = ['value_type', 'valueType', 'type'] as const
const MASKED_SECRET_PLACEHOLDERS = new Set(['[__HIDDEN__]'])

export function encodeDslContent(value: string) {
  const bytes = new TextEncoder().encode(value)
  const chunkSize = 0x8000
  const chunks: string[] = []

  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))

  return btoa(chunks.join(''))
}

function parseDsl(content: string) {
  try {
    return loadYaml(content) as DslMetadata | undefined
  }
  catch {
    return undefined
  }
}

function isRecord(value: unknown): value is DslEnvVarRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEnvVarDefaultValue(value: unknown) {
  if (value === undefined || value === null)
    return undefined

  let normalizedValue: string | undefined
  if (typeof value === 'string') {
    normalizedValue = value
  }
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    normalizedValue = String(value)
  }
  else {
    try {
      normalizedValue = JSON.stringify(value)
    }
    catch {
      normalizedValue = undefined
    }
  }

  if (!normalizedValue?.trim())
    return undefined
  if (MASKED_SECRET_PLACEHOLDERS.has(normalizedValue))
    return undefined

  return normalizedValue
}

function envVarDefaultValue(record: DslEnvVarRecord) {
  for (const field of ENV_VAR_DEFAULT_VALUE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field))
      return normalizeEnvVarDefaultValue(record[field])
  }

  return undefined
}

function envVarValueType(record: DslEnvVarRecord) {
  for (const field of ENV_VAR_VALUE_TYPE_FIELDS) {
    const valueType = stringValue(record[field])
    if (valueType)
      return valueType
  }

  return undefined
}

export function dslAppName(content: string) {
  const name = parseDsl(content)?.app?.name

  return typeof name === 'string' ? name.trim() : ''
}

function dslAppMode(content: string) {
  return stringValue(parseDsl(content)?.app?.mode)
}

export function isWorkflowDsl(content: string) {
  return dslAppMode(content) === AppModeEnum.WORKFLOW
}

export function dslEnvVarSlots(content: string): DslEnvVarSlot[] {
  const environmentVariables = parseDsl(content)?.workflow?.environment_variables
  if (!Array.isArray(environmentVariables))
    return []

  const seenKeys = new Set<string>()

  return environmentVariables
    .flatMap((envVar): DslEnvVarSlot[] => {
      if (!isRecord(envVar))
        return []

      const key = stringValue(envVar.name ?? envVar.key ?? envVar.variable)
      if (!key || seenKeys.has(key))
        return []

      seenKeys.add(key)
      const description = stringValue(envVar.description)
      const defaultValue = envVarDefaultValue(envVar)
      const valueType = envVarValueType(envVar)

      return [{
        key,
        ...(description ? { description } : {}),
        ...(valueType ? { valueType } : {}),
        ...(defaultValue !== undefined
          ? {
              defaultValue,
              hasDefaultValue: true,
            }
          : {}),
      }]
    })
}
