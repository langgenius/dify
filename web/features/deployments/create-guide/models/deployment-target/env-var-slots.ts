import type {
  EnvVarSlot,
} from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod } from '../../types'
import type { EnvVarBindingSlot } from '@/features/deployments/components/env-var-bindings'
import type { DslEnvVarSlot } from '@/features/deployments/dsl'
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

function deploymentEnvVarBindingSlot(slot: EnvVarSlot): EnvVarBindingSlot | undefined {
  const key = slot.key.trim()
  if (!key)
    return undefined

  return {
    ...slot,
    key,
    valueType: envVarBindingValueType(slot.valueType),
  }
}

function normalizeDslEnvVarSlotMetadata(slot: DslEnvVarSlot): EnvVarSlotMetadata | undefined {
  const key = slot.key.trim()
  if (!key)
    return undefined

  return {
    key,
    ...(slot.description ? { description: slot.description } : {}),
    ...(slot.defaultValue !== undefined ? { defaultValue: slot.defaultValue, hasDefaultValue: true } : {}),
    ...(slot.valueType ? { valueType: envVarBindingValueType(slot.valueType) } : {}),
  }
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

function createDeploymentEnvVarSlots(shouldLoadDeploymentTarget: boolean, slots: EnvVarSlot[] | undefined) {
  return shouldLoadDeploymentTarget
    ? slots?.flatMap((slot): EnvVarBindingSlot[] => {
      const bindingSlot = deploymentEnvVarBindingSlot(slot)
      return bindingSlot ? [bindingSlot] : []
    }) ?? []
    : []
}

function createDslEnvVarMetadataSlots(dslContent: string, method: GuideMethod) {
  return method === 'importDsl' && dslContent
    ? dslEnvVarSlots(dslContent).flatMap((slot): EnvVarSlotMetadata[] => {
        const metadata = normalizeDslEnvVarSlotMetadata(slot)
        return metadata ? [metadata] : []
      })
    : []
}

export function createTargetEnvVarSlots({
  dslContent,
  method,
  shouldLoadDeploymentTarget,
  slots,
}: {
  dslContent: string
  method: GuideMethod
  shouldLoadDeploymentTarget: boolean
  slots: EnvVarSlot[] | undefined
}) {
  const deploymentOptionEnvVarSlots = createDeploymentEnvVarSlots(shouldLoadDeploymentTarget, slots)
  const dslEnvVarMetadataSlots = createDslEnvVarMetadataSlots(dslContent, method)

  return mergeEnvVarSlotMetadata(deploymentOptionEnvVarSlots, dslEnvVarMetadataSlots)
}
