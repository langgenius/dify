import type {
  EnvVarInput,
  EnvVarSlot,
} from '@dify/contracts/enterprise/types.gen'

export type EnvVarValues = Record<string, string>
export type DeploymentEnvVarSlot = EnvVarSlot & {
  description?: string
  defaultValue?: string
}

export function envVarSlotKey(slot: EnvVarSlot) {
  return slot.key?.trim() ?? ''
}

export function hasEnvVarSlotKey(slot?: EnvVarSlot) {
  return Boolean(slot && envVarSlotKey(slot))
}

export function hasMissingRequiredEnvVarValue(slot: EnvVarSlot, values: EnvVarValues) {
  const key = envVarSlotKey(slot)

  return !key || !values[key]?.trim()
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

    return {
      ...slot,
      ...(description ? { description } : {}),
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
    const defaultValue = slot.defaultValue

    if (!key || defaultValue === undefined || !defaultValue.trim())
      return
    if (Object.prototype.hasOwnProperty.call(nextValues, key))
      return

    nextValues[key] = defaultValue
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

      const value = values[key]
      if (!value?.trim())
        return undefined

      return {
        key,
        value,
      }
    })
    .filter((envVar): envVar is EnvVarInput => Boolean(envVar))
}
