import type { EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod } from './types'
import type {
  EnvVarBindingSlot,
  EnvVarValues,
} from '@/features/deployments/components/env-var-bindings'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { dslEnvVarSlots } from '@/features/deployments/dsl'

type EnvVarSlotMetadata = {
  key: string
  description?: string
  defaultValue?: string
  hasDefaultValue?: boolean
  valueType?: EnvVarBindingSlot['valueType']
}

function envVarBindingValueType(value?: string): EnvVarBindingSlot['valueType'] {
  return value === 'number' || value === 'secret' ? value : 'string'
}

function mergeEnvVarSlotMetadata(slots: EnvVarBindingSlot[], metadataSlots: EnvVarSlotMetadata[]) {
  if (metadataSlots.length === 0)
    return slots

  const metadataByKey = new Map(
    metadataSlots.map(slot => [slot.key, slot] as const),
  )

  return slots.map((slot) => {
    const metadata = metadataByKey.get(slot.key)
    if (!metadata)
      return slot

    const nextSlot = { ...slot }

    if (!nextSlot.description && metadata.description)
      nextSlot.description = metadata.description
    if (!nextSlot.hasDefaultValue && metadata.defaultValue !== undefined) {
      nextSlot.defaultValue = metadata.defaultValue
      nextSlot.hasDefaultValue = true
    }
    if (nextSlot.valueType === 'string' && metadata.valueType)
      nextSlot.valueType = metadata.valueType

    return nextSlot
  })
}

export function deploymentTargetEnvVarSlots({
  dslContent,
  method,
  slots,
}: {
  dslContent: string
  method: GuideMethod
  slots: EnvVarSlot[] | undefined
}) {
  // Deployment options own the canonical slot list; DSL metadata only enriches import-DSL defaults.
  const deploymentOptionEnvVarSlots = slots?.flatMap((slot): EnvVarBindingSlot[] => {
    const key = slot.key.trim()
    if (!key)
      return []

    return [{
      ...slot,
      key,
      valueType: envVarBindingValueType(slot.valueType),
    }]
  }) ?? []
  const dslEnvVarMetadataSlots = method === 'importDsl' && dslContent
    ? dslEnvVarSlots(dslContent).flatMap((slot): EnvVarSlotMetadata[] => {
        const key = slot.key.trim()
        if (!key)
          return []

        return [{
          key,
          ...(slot.description ? { description: slot.description } : {}),
          ...(slot.defaultValue !== undefined ? { defaultValue: slot.defaultValue, hasDefaultValue: true } : {}),
          ...(slot.valueType ? { valueType: envVarBindingValueType(slot.valueType) } : {}),
        }]
      })
    : []

  return mergeEnvVarSlotMetadata(deploymentOptionEnvVarSlots, dslEnvVarMetadataSlots)
}

export function deploymentTargetRequiredEnvVarsReady(slots: EnvVarBindingSlot[], values: EnvVarValues) {
  return slots.every((slot) => {
    const selection = values[slot.key]
    const valueSource = selection?.valueSource
      ?? (slot.hasDefaultValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
        : slot.hasLastValue
          ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
          : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
      return Boolean(slot.hasLastValue)
    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
      return Boolean(slot.hasDefaultValue)
    if (!selection?.value)
      return false

    return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
  })
}
