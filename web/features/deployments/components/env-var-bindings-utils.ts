import type { EnvVarInput, EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'

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

export function envVarSlotKey(slot: EnvVarSlot) {
  return slot.key?.trim() ?? ''
}

export function hasEnvVarSlotKey(slot?: EnvVarSlot) {
  return Boolean(slot && envVarSlotKey(slot))
}

export function hasEnvVarDefaultValue(slot: EnvVarSlot) {
  return Boolean(slot.hasDefaultValue || envVarSlotValue(slot.defaultValue) !== undefined)
}

export function hasEnvVarLastValue(slot: EnvVarSlot) {
  return Boolean(slot.hasLastValue || envVarSlotValue(slot.lastValue) !== undefined)
}

export function envVarSlotValueType(slot: EnvVarSlot): EnvVarValueType {
  const valueType = slot.valueType?.trim().toLowerCase()
  if (valueType === 'number')
    return 'number'
  if (valueType === 'secret')
    return 'secret'

  return 'string'
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
  slot: EnvVarSlot,
  options?: EnvVarValueSelectionOptions,
): EnvVarValueSelection {
  if (options?.preferDefaultValue && hasEnvVarDefaultValue(slot)) {
    return {
      valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
    }
  }

  if (hasEnvVarLastValue(slot)) {
    return {
      valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
    }
  }

  if (hasEnvVarDefaultValue(slot)) {
    return {
      valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
    }
  }

  return {
    valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
  }
}

export function envVarValueSelectionForSlot(
  slot: EnvVarSlot,
  selection?: EnvVarValueSelection,
  options?: EnvVarValueSelectionOptions,
): EnvVarValueSelection {
  if (!selection)
    return defaultEnvVarValueSelection(slot, options)

  if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT && hasEnvVarLastValue(slot))
    return selection

  if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT && hasEnvVarDefaultValue(slot))
    return selection

  if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT && hasEnvVarLastValue(slot)) {
    return {
      valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
    }
  }

  return {
    ...selection,
    valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
  }
}

export function hasMissingRequiredEnvVarValue(slot: EnvVarSlot, values: EnvVarValues) {
  const key = envVarSlotKey(slot)
  if (!key)
    return true

  const selection = envVarValueSelectionForSlot(slot, values[key])

  if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
    return !hasEnvVarLastValue(slot)
  if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
    return !hasEnvVarDefaultValue(slot)

  const value = selection.value?.trim()
  if (!value)
    return true
  if (envVarSlotValueType(slot) === 'number')
    return Number.isNaN(Number(value))

  return false
}

export function mergeEnvVarSlotMetadata(
  slots: EnvVarSlot[],
  metadataSlots: EnvVarSlot[],
): EnvVarSlot[] {
  if (metadataSlots.length === 0)
    return slots

  const metadataByKey = new Map(
    metadataSlots
      .flatMap((slot): [string, EnvVarSlot][] => {
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

    const description = slot.description?.trim() || metadata.description?.trim()
    const defaultValue = slot.defaultValue ?? metadata.defaultValue
    const lastValue = slot.lastValue ?? metadata.lastValue
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

export function envVarSlotsWithoutLastDeploymentValues(slots: EnvVarSlot[]) {
  return slots.map((slot) => {
    const {
      hasLastValue: _hasLastValue,
      lastValue: _lastValue,
      ...slotWithoutLastValue
    } = slot

    return slotWithoutLastValue
  })
}

export function envVarSlotsWithoutDefaultValues(slots: EnvVarSlot[]) {
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
  slots: EnvVarSlot[],
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

      if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
        if (!hasEnvVarLastValue(slot))
          return []

        return [{
          key,
          valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
        }]
      }

      if (selection.valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
        if (!hasEnvVarDefaultValue(slot))
          return []

        return [{
          key,
          valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
        }]
      }

      const literalValue = selection.value?.trim()
      if (!literalValue)
        return []
      if (envVarSlotValueType(slot) === 'number' && Number.isNaN(Number(literalValue)))
        return []

      return [{
        key,
        value: selection.value,
        valueSource: ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
      }]
    })
}
