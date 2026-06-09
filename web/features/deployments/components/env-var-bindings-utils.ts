import type {
  EnvVarInput,
  EnvVarSlot,
} from '@dify/contracts/enterprise/types.gen'

export type EnvVarValueSource = NonNullable<EnvVarInput['valueSource']>

export type EnvVarValueSelection = {
  valueSource: EnvVarValueSource
  value?: string
}

export type EnvVarValues = Record<string, EnvVarValueSelection>
export type EnvVarValueType = 'string' | 'number' | 'secret'
export type EnvVarValueSelectionOptions = {
  preferDefaultValue?: boolean
}
export type DeploymentEnvVarSlot = EnvVarSlot & {
  description?: string
}

export const ENV_VAR_VALUE_SOURCE_LITERAL = 'ENV_VAR_VALUE_SOURCE_LITERAL' satisfies EnvVarValueSource
export const ENV_VAR_VALUE_SOURCE_DSL_DEFAULT = 'ENV_VAR_VALUE_SOURCE_DSL_DEFAULT' satisfies EnvVarValueSource
export const ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT = 'ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT' satisfies EnvVarValueSource
const ENV_VAR_VALUE_TYPE_STRING = 'string' satisfies EnvVarValueType
export const ENV_VAR_VALUE_TYPE_NUMBER = 'number' satisfies EnvVarValueType
export const ENV_VAR_VALUE_TYPE_SECRET = 'secret' satisfies EnvVarValueType

export function envVarSlotKey(slot: EnvVarSlot) {
  return slot.key?.trim() ?? ''
}

export function hasEnvVarSlotKey(slot?: EnvVarSlot) {
  return Boolean(slot && envVarSlotKey(slot))
}

export function hasEnvVarDefaultValue(slot: EnvVarSlot | DeploymentEnvVarSlot) {
  return Boolean(slot.hasDefaultValue || envVarSlotValue(slot.defaultValue) !== undefined)
}

export function hasEnvVarLastValue(slot: EnvVarSlot) {
  return Boolean(slot.hasLastValue || envVarSlotValue(slot.lastValue) !== undefined)
}

export function envVarSlotValueType(slot: EnvVarSlot | DeploymentEnvVarSlot): EnvVarValueType {
  const valueType = slot.valueType?.trim().toLowerCase()
  if (valueType === ENV_VAR_VALUE_TYPE_NUMBER)
    return ENV_VAR_VALUE_TYPE_NUMBER
  if (valueType === ENV_VAR_VALUE_TYPE_SECRET)
    return ENV_VAR_VALUE_TYPE_SECRET

  return ENV_VAR_VALUE_TYPE_STRING
}

export function envVarSlotValue(value: unknown) {
  if (value === undefined || value === null)
    return undefined
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)

  try {
    return JSON.stringify(value)
  }
  catch {
    return undefined
  }
}

function defaultEnvVarValueSelection(
  slot: EnvVarSlot | DeploymentEnvVarSlot,
  options?: EnvVarValueSelectionOptions,
): EnvVarValueSelection {
  if (options?.preferDefaultValue && hasEnvVarDefaultValue(slot)) {
    return {
      valueSource: ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
    }
  }

  if (hasEnvVarLastValue(slot)) {
    return {
      valueSource: ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
    }
  }

  if (hasEnvVarDefaultValue(slot)) {
    return {
      valueSource: ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
    }
  }

  return {
    valueSource: ENV_VAR_VALUE_SOURCE_LITERAL,
  }
}

export function envVarValueSelectionForSlot(
  slot: EnvVarSlot | DeploymentEnvVarSlot,
  selection?: EnvVarValueSelection,
  options?: EnvVarValueSelectionOptions,
): EnvVarValueSelection {
  if (!selection)
    return defaultEnvVarValueSelection(slot, options)

  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT && hasEnvVarLastValue(slot))
    return selection

  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT && hasEnvVarDefaultValue(slot))
    return selection

  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT && hasEnvVarLastValue(slot)) {
    return {
      valueSource: ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
    }
  }

  return {
    ...selection,
    valueSource: ENV_VAR_VALUE_SOURCE_LITERAL,
  }
}

export function hasMissingRequiredEnvVarValue(slot: EnvVarSlot, values: EnvVarValues) {
  const key = envVarSlotKey(slot)
  if (!key)
    return true

  const selection = envVarValueSelectionForSlot(slot, values[key])

  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
    return !hasEnvVarLastValue(slot)
  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
    return !hasEnvVarDefaultValue(slot)

  const value = selection.value?.trim()
  if (!value)
    return true
  if (envVarSlotValueType(slot) === ENV_VAR_VALUE_TYPE_NUMBER)
    return Number.isNaN(Number(value))

  return false
}

export function mergeEnvVarSlotMetadata(
  slots: EnvVarSlot[],
  metadataSlots: DeploymentEnvVarSlot[],
): DeploymentEnvVarSlot[] {
  if (metadataSlots.length === 0)
    return slots

  const metadataByKey = new Map(
    metadataSlots
      .flatMap((slot): [string, DeploymentEnvVarSlot][] => {
        const key = envVarSlotKey(slot)
        if (!key)
          return []

        return [[key, slot]]
      }),
  )

  return slots.map((slot) => {
    const key = envVarSlotKey(slot)
    const metadata = metadataByKey.get(key)
    if (!metadata)
      return slot

    const currentSlot = slot as DeploymentEnvVarSlot
    const description = currentSlot.description?.trim() || metadata.description?.trim()
    const defaultValue = currentSlot.defaultValue ?? metadata.defaultValue
    const lastValue = currentSlot.lastValue ?? metadata.lastValue
    const hasDefaultValue = slot.hasDefaultValue ?? metadata.hasDefaultValue ?? defaultValue !== undefined
    const hasLastValue = slot.hasLastValue ?? metadata.hasLastValue ?? lastValue !== undefined
    const valueType = slot.valueType ?? metadata.valueType

    return {
      ...slot,
      ...(description ? { description } : {}),
      ...(hasDefaultValue ? { hasDefaultValue } : {}),
      ...(hasLastValue ? { hasLastValue } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(lastValue !== undefined ? { lastValue } : {}),
      ...(valueType ? { valueType } : {}),
    }
  })
}

export function envVarSlotsWithoutLastDeploymentValues(slots: DeploymentEnvVarSlot[]) {
  return slots.map((slot) => {
    const {
      hasLastValue: _hasLastValue,
      lastValue: _lastValue,
      ...slotWithoutLastValue
    } = slot

    return slotWithoutLastValue
  })
}

export function envVarSlotsWithoutDefaultValues(slots: DeploymentEnvVarSlot[]) {
  return slots.map((slot) => {
    const {
      hasDefaultValue: _hasDefaultValue,
      defaultValue: _defaultValue,
      ...slotWithoutDefaultValue
    } = slot

    return slotWithoutDefaultValue
  })
}

export function envVarValuesWithDefaults(
  values: EnvVarValues,
  slots: DeploymentEnvVarSlot[],
  options?: EnvVarValueSelectionOptions,
): EnvVarValues {
  let hasChanges = false
  const nextValues: EnvVarValues = { ...values }

  slots.forEach((slot) => {
    const key = envVarSlotKey(slot)

    if (!key)
      return

    const nextSelection = envVarValueSelectionForSlot(slot, nextValues[key], options)
    if (nextValues[key] === nextSelection)
      return

    nextValues[key] = nextSelection
    hasChanges = true
  })

  return hasChanges ? nextValues : values
}

export function selectedDeploymentEnvVars(
  slots: EnvVarSlot[],
  values: EnvVarValues,
): EnvVarInput[] {
  return slots
    .flatMap((slot): EnvVarInput[] => {
      const key = envVarSlotKey(slot)
      if (!key)
        return []

      const selection = envVarValueSelectionForSlot(slot, values[key])

      if (selection.valueSource === ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
        if (!hasEnvVarLastValue(slot))
          return []

        return [{
          key,
          valueSource: ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
        }]
      }

      if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
        if (!hasEnvVarDefaultValue(slot))
          return []

        return [{
          key,
          valueSource: ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
        }]
      }

      const literalValue = selection.value?.trim()
      if (!literalValue)
        return []
      if (envVarSlotValueType(slot) === ENV_VAR_VALUE_TYPE_NUMBER && Number.isNaN(Number(literalValue)))
        return []

      return [{
        key,
        value: selection.value,
        valueSource: ENV_VAR_VALUE_SOURCE_LITERAL,
      }]
    })
}
