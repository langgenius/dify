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
export type DeploymentEnvVarSlot = EnvVarSlot & {
  description?: string
  defaultValue?: string
}

export const ENV_VAR_VALUE_SOURCE_LITERAL = 'ENV_VAR_VALUE_SOURCE_LITERAL' satisfies EnvVarValueSource
export const ENV_VAR_VALUE_SOURCE_DSL_DEFAULT = 'ENV_VAR_VALUE_SOURCE_DSL_DEFAULT' satisfies EnvVarValueSource
export const ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT = 'ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT' satisfies EnvVarValueSource

export function envVarSlotKey(slot: EnvVarSlot) {
  return slot.key?.trim() ?? ''
}

export function hasEnvVarSlotKey(slot?: EnvVarSlot) {
  return Boolean(slot && envVarSlotKey(slot))
}

export function hasEnvVarDefaultValue(slot: EnvVarSlot | DeploymentEnvVarSlot) {
  const deploymentSlot = slot as DeploymentEnvVarSlot

  return Boolean(slot.hasDefaultValue || deploymentSlot.defaultValue !== undefined)
}

export function hasEnvVarLastValue(slot: EnvVarSlot) {
  return Boolean(slot.hasLastValue)
}

function defaultEnvVarValueSelection(slot: EnvVarSlot | DeploymentEnvVarSlot): EnvVarValueSelection {
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
): EnvVarValueSelection {
  if (!selection)
    return defaultEnvVarValueSelection(slot)

  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT && hasEnvVarLastValue(slot))
    return selection

  if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT && hasEnvVarDefaultValue(slot))
    return selection

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

  return !selection.value?.trim()
}

export function mergeEnvVarSlotMetadata(
  slots: EnvVarSlot[],
  metadataSlots: DeploymentEnvVarSlot[],
): DeploymentEnvVarSlot[] {
  if (metadataSlots.length === 0)
    return slots

  const metadataByKey = new Map(
    metadataSlots
      .map((slot): [string, DeploymentEnvVarSlot] | undefined => {
        const key = envVarSlotKey(slot)
        return key ? [key, slot] : undefined
      })
      .filter((entry): entry is [string, DeploymentEnvVarSlot] => Boolean(entry)),
  )

  return slots.map((slot) => {
    const key = envVarSlotKey(slot)
    const metadata = metadataByKey.get(key)
    if (!metadata)
      return slot

    const currentSlot = slot as DeploymentEnvVarSlot
    const description = currentSlot.description?.trim() || metadata.description?.trim()
    const defaultValue = currentSlot.defaultValue ?? metadata.defaultValue
    const hasDefaultValue = slot.hasDefaultValue ?? metadata.hasDefaultValue ?? defaultValue !== undefined
    const maskedDefaultValue = slot.maskedDefaultValue ?? metadata.maskedDefaultValue

    return {
      ...slot,
      ...(description ? { description } : {}),
      ...(hasDefaultValue ? { hasDefaultValue } : {}),
      ...(maskedDefaultValue ? { maskedDefaultValue } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    }
  })
}

export function envVarValuesWithDefaults(
  values: EnvVarValues,
  slots: DeploymentEnvVarSlot[],
): EnvVarValues {
  let hasChanges = false
  const nextValues: EnvVarValues = { ...values }

  slots.forEach((slot) => {
    const key = envVarSlotKey(slot)

    if (!key)
      return

    const nextSelection = envVarValueSelectionForSlot(slot, nextValues[key])
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
    .map((slot): EnvVarInput | undefined => {
      const key = envVarSlotKey(slot)
      if (!key)
        return undefined

      const selection = envVarValueSelectionForSlot(slot, values[key])

      if (selection.valueSource === ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
        if (!hasEnvVarLastValue(slot))
          return undefined

        return {
          key,
          valueSource: ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT,
        }
      }

      if (selection.valueSource === ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
        if (!hasEnvVarDefaultValue(slot))
          return undefined

        return {
          key,
          valueSource: ENV_VAR_VALUE_SOURCE_DSL_DEFAULT,
        }
      }

      if (!selection.value?.trim())
        return undefined

      return {
        key,
        value: selection.value,
        valueSource: ENV_VAR_VALUE_SOURCE_LITERAL,
      }
    })
    .filter((envVar): envVar is EnvVarInput => Boolean(envVar))
}
