'use client'

import type {
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarBindingSlot, EnvVarValues, EnvVarValueSelection } from '../components/env-var-bindings'
import type { BindingSelections, EnvironmentOption, GuideMethod } from './types'
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

export function deploymentEnvironmentOptions(environments?: Environment[]): EnvironmentOption[] {
  return environments?.flatMap((environment) => {
    const environmentId = environment.id
    if (!environmentId)
      return []

    return [{
      ...environment,
      id: environmentId,
    }]
  }) ?? []
}

function mergeEnvVarSlotMetadata(slots: EnvVarBindingSlot[], metadataSlots: EnvVarBindingSlot[]) {
  if (metadataSlots.length === 0)
    return slots

  const metadataByKey = new Map(
    metadataSlots.map(slot => [slot.key, slot] as const),
  )

  return slots.map((slot) => {
    const metadata = metadataByKey.get(slot.key)
    if (!metadata)
      return slot

    const description = slot.description || metadata.description
    const defaultValue = slot.defaultValue ?? metadata.defaultValue
    const lastValue = slot.lastValue ?? metadata.lastValue
    const hasDefaultValue = slot.hasDefaultValue ?? metadata.hasDefaultValue
    const hasLastValue = slot.hasLastValue ?? metadata.hasLastValue

    return {
      ...slot,
      ...(description ? { description } : {}),
      ...(hasDefaultValue ? { hasDefaultValue } : {}),
      ...(hasLastValue ? { hasLastValue } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(lastValue !== undefined ? { lastValue } : {}),
    }
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
  const [manualBindingSelections, setManualBindingSelections] = useState<BindingSelections>({})
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
    ? deploymentEnvironmentOptions(deployableEnvironmentsQuery.data?.data)
    : []
  const bindingSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const deploymentOptionEnvVarSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.envVarSlots?.flatMap((slot): EnvVarBindingSlot[] => {
        const key = slot.key?.trim()
        if (!key)
          return []

        return [{
          ...slot,
          key,
          valueType: slot.valueType === 'number' || slot.valueType === 'secret' ? slot.valueType : 'string',
        }]
      }) ?? []
    : []
  const dslEnvVarSlotMetadata = method === 'importDsl' && dslContent
    ? dslEnvVarSlots(dslContent).flatMap((slot): EnvVarBindingSlot[] => {
        const key = slot.key?.trim()
        if (!key)
          return []

        return [{
          ...slot,
          key,
          valueType: slot.valueType === 'number' || slot.valueType === 'secret' ? slot.valueType : 'string',
        }]
      })
    : []
  const envVarSlots = mergeEnvVarSlotMetadata(deploymentOptionEnvVarSlots, dslEnvVarSlotMetadata)
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId)) ?? environments[0]
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
