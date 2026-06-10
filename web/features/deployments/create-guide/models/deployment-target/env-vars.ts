import type { EnvVarInput, EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod } from '../../types'
import type { EnvVarBindingSlot, EnvVarValues } from '@/features/deployments/components/env-var-bindings'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import {
  createTargetEnvVarSlots,
} from './env-var-slots'

function createEnvVarValueSource(slot: EnvVarBindingSlot, values: EnvVarValues) {
  return values[slot.key]?.valueSource
    ?? (slot.hasDefaultValue
      ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
      : slot.hasLastValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
        : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)
}

function areRequiredEnvVarsReady(slots: EnvVarBindingSlot[], values: EnvVarValues) {
  return slots.every((slot) => {
    const selection = values[slot.key]
    const valueSource = createEnvVarValueSource(slot, values)

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
      return Boolean(slot.hasLastValue)
    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
      return Boolean(slot.hasDefaultValue)
    if (!selection?.value)
      return false

    return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
  })
}

export function createDeploymentEnvVarInputs(slots: EnvVarBindingSlot[], values: EnvVarValues): EnvVarInput[] {
  return slots.flatMap((slot): EnvVarInput[] => {
    const selection = values[slot.key]
    const valueSource = createEnvVarValueSource(slot, values)

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
      return slot.hasLastValue
        ? [{ key: slot.key, valueSource }]
        : []
    }

    if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
      return slot.hasDefaultValue
        ? [{ key: slot.key, valueSource }]
        : []
    }

    if (!selection?.value || (slot.valueType === 'number' && Number.isNaN(Number(selection.value))))
      return []

    return [{
      key: slot.key,
      value: selection.value,
      valueSource,
    }]
  })
}

export function createDeploymentTargetEnvVars({
  dslContent,
  envVarValues,
  method,
  shouldLoadDeploymentTarget,
  slots,
}: {
  dslContent: string
  envVarValues: EnvVarValues
  method: GuideMethod
  shouldLoadDeploymentTarget: boolean
  slots: EnvVarSlot[] | undefined
}) {
  const envVarSlots = createTargetEnvVarSlots({
    dslContent,
    method,
    shouldLoadDeploymentTarget,
    slots,
  })
  const requiredEnvVarsReady = areRequiredEnvVarsReady(envVarSlots, envVarValues)

  return {
    envVarSlots,
    requiredEnvVarsReady,
  }
}
