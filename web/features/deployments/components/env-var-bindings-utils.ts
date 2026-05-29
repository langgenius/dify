import type {
  EnvVarInput,
  EnvVarSlot,
} from '@dify/contracts/enterprise/types.gen'

export type EnvVarValues = Record<string, string>

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
