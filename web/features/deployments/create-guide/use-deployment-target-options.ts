'use client'

import type {
  EnvVarSlot,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarBindingSlot, EnvVarValues, EnvVarValueSelection } from '../components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '../components/runtime-credential-bindings-utils'
import type { DslEnvVarSlot } from '../dsl'
import type { GuideMethod } from './types'
import type { App } from '@/types/app'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import {
  runtimeCredentialSlotKey,
  selectedRuntimeCredentialSelections,
} from '../components/runtime-credential-bindings-utils'
import { dslEnvVarSlots } from '../dsl'
import { environmentMatchesIdentifier } from '../environment'
import { useUnsupportedDslNodesFromError } from './use-unsupported-dsl-nodes'

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

export function useDeploymentTargetOptions({
  dslContent,
  dslReadError,
  dslUnsupportedMode,
  effectiveSelectedApp,
  encodedDslContent,
  hasDslContent,
  isReadingDsl,
  method,
  shouldResolveDeploymentTarget,
}: {
  dslContent: string
  dslReadError: boolean
  dslUnsupportedMode: boolean
  effectiveSelectedApp?: App
  encodedDslContent: string
  hasDslContent: boolean
  isReadingDsl: boolean
  method: GuideMethod
  shouldResolveDeploymentTarget: boolean
}) {
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [manualBindingSelections, setManualBindingSelections] = useState<RuntimeCredentialBindingSelections>({})
  const [envVarValues, setEnvVarValues] = useState<EnvVarValues>({})
  const shouldLoadSourceDeploymentOptions = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const shouldLoadDslDeploymentOptions = method === 'importDsl' && hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
  const shouldLoadSourceDeploymentTarget = shouldLoadSourceDeploymentOptions && shouldResolveDeploymentTarget
  const shouldLoadDslDeploymentTarget = shouldLoadDslDeploymentOptions && shouldResolveDeploymentTarget
  const shouldLoadDeploymentTarget = shouldLoadSourceDeploymentTarget || shouldLoadDslDeploymentTarget

  const deployableEnvironmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled: shouldLoadDeploymentTarget,
  }))
  const sourceDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
      input: shouldLoadSourceDeploymentOptions && effectiveSelectedApp?.id
        ? {
            body: {
              sourceAppId: effectiveSelectedApp.id,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const dslDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
      input: shouldLoadDslDeploymentOptions
        ? {
            body: {
              dsl: encodedDslContent,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const deploymentOptionsQuery = method === 'importDsl' ? dslDeploymentOptionsQuery : sourceDeploymentOptionsQuery
  const deploymentOptions = deploymentOptionsQuery.data?.options
  const {
    clearUnsupportedDslNodes,
    unsupportedDslNodes,
  } = useUnsupportedDslNodesFromError({
    error: deploymentOptionsQuery.error,
    isError: deploymentOptionsQuery.isError,
  })
  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data ?? []
    : []
  const bindingSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.credentialSlots.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const deploymentOptionEnvVarSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.envVarSlots.flatMap((slot): EnvVarBindingSlot[] => {
      const bindingSlot = deploymentEnvVarBindingSlot(slot)
      return bindingSlot ? [bindingSlot] : []
    }) ?? []
    : []
  const dslEnvVarMetadataSlots = method === 'importDsl' && dslContent
    ? dslEnvVarSlots(dslContent).flatMap((slot): EnvVarSlotMetadata[] => {
        const metadata = normalizeDslEnvVarSlotMetadata(slot)
        return metadata ? [metadata] : []
      })
    : []
  const envVarSlots = mergeEnvVarSlotMetadata(deploymentOptionEnvVarSlots, dslEnvVarMetadataSlots)
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id
  const selectedEnvironment = effectiveSelectedEnvironmentId
    ? environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId))
    : undefined
  const bindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const requiredEnvVarsReady = envVarSlots.every((slot) => {
    const selection = envVarValues[slot.key]
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
  const isEnvironmentLoading = shouldLoadDeploymentTarget && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
  const isBindingLoading = shouldLoadDeploymentTarget && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))

  function resetTargetOptions() {
    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    setEnvVarValues({})
  }

  return {
    bindingSelections,
    bindingSlots,
    clearUnsupportedDslNodes,
    deployableEnvironmentsQuery,
    deploymentOptions,
    deploymentOptionsQuery,
    effectiveSelectedEnvironmentId,
    environments,
    envVarSlots,
    envVarValues,
    isBindingLoading,
    isEnvironmentLoading,
    onSelectBinding: (slot: string, value: string) => {
      setManualBindingSelections(prev => ({ ...prev, [slot]: value }))
    },
    onSelectEnvironment: setSelectedEnvironmentId,
    onSetEnvVar: (key: string, value: EnvVarValueSelection) => {
      setEnvVarValues(prev => ({ ...prev, [key]: value }))
    },
    requiredEnvVarsReady,
    resetTargetOptions,
    selectedEnvironment,
    selectedEnvironmentId,
    shouldLoadDeploymentTarget,
    unsupportedDslNodes,
  }
}
