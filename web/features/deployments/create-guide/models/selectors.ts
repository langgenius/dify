import type { EnvVarInput } from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod } from '../types'
import type { EnvVarBindingSlot, EnvVarValues } from '@/features/deployments/components/env-var-bindings'
import type { App } from '@/types/app'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { dslAppName, encodeDslContent } from '@/features/deployments/dsl'
import {
  createGuideSourceName,
  isCreateGuideDslUnsupportedMode,
} from './guide-derived-state'

export type CreateGuideDslState = {
  dslDefaultAppName: string
  dslUnsupportedMode: boolean
  encodedDslContent: string
  hasDslContent: boolean
}

export function createDslState({
  dslContent,
  dslReadError,
  isReadingDsl,
  method,
}: {
  dslContent: string
  dslReadError: boolean
  isReadingDsl: boolean
  method: GuideMethod
}): CreateGuideDslState {
  const hasDslContent = Boolean(dslContent.trim())
  const dslUnsupportedMode = isCreateGuideDslUnsupportedMode({
    dslContent,
    dslReadError,
    hasDslContent,
    isReadingDsl,
    method,
  })

  return {
    dslDefaultAppName: dslContent ? dslAppName(dslContent) : '',
    dslUnsupportedMode,
    encodedDslContent: hasDslContent ? encodeDslContent(dslContent) : '',
    hasDslContent,
  }
}

export function createSourceName({
  dslFallbackAppName,
  dslState,
  method,
  selectedApp,
}: {
  dslFallbackAppName: string
  dslState: CreateGuideDslState
  method: GuideMethod
  selectedApp?: App
}) {
  return createGuideSourceName({
    dslDefaultAppName: dslState.dslDefaultAppName,
    dslFallbackAppName,
    method,
    selectedApp,
  })
}

export function createEnvVarValueSource(slot: EnvVarBindingSlot, values: EnvVarValues) {
  return values[slot.key]?.valueSource
    ?? (slot.hasDefaultValue
      ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
      : slot.hasLastValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
        : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)
}

export function areRequiredEnvVarsReady(slots: EnvVarBindingSlot[], values: EnvVarValues) {
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
