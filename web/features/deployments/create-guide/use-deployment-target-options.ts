'use client'

import type {
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarValues, EnvVarValueSelection } from '../components/env-var-bindings-utils'
import type { BindingSelections, EnvironmentOption, GuideMethod } from './types'
import type { App } from '@/types/app'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import {
  envVarSlotsWithoutLastDeploymentValues,
  envVarValuesWithDefaults,
  hasEnvVarSlotKey,
  mergeEnvVarSlotMetadata,
} from '../components/env-var-bindings-utils'
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
  const deploymentOptionEnvVarSourceSlots = deploymentOptions?.envVarSlots
  const deploymentOptionEnvVarSlots = shouldLoadDeploymentTarget
    ? deploymentOptionEnvVarSourceSlots?.filter(hasEnvVarSlotKey) ?? []
    : []
  const dslEnvVarSlotMetadata = method === 'importDsl' && dslContent ? dslEnvVarSlots(dslContent) : []
  const envVarSlots = envVarSlotsWithoutLastDeploymentValues(
    mergeEnvVarSlotMetadata(deploymentOptionEnvVarSlots, dslEnvVarSlotMetadata),
  )
  const effectiveEnvVarValues = envVarValuesWithDefaults(envVarValues, envVarSlots, { preferDefaultValue: true })
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId)) ?? environments[0]
  const bindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
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
    effectiveEnvVarValues,
    effectiveSelectedEnvironmentId,
    environments,
    envVarSlots,
    envVarValues: effectiveEnvVarValues,
    isBindingLoading,
    isEnvironmentLoading,
    onSelectBinding: (slot: string, value: string) => {
      setManualBindingSelections(prev => ({ ...prev, [slot]: value }))
    },
    onSelectEnvironment: setSelectedEnvironmentId,
    onSetEnvVar: (key: string, value: EnvVarValueSelection) => {
      setEnvVarValues(prev => ({ ...prev, [key]: value }))
    },
    resetTargetOptions,
    selectedEnvironment,
    selectedEnvironmentId,
    shouldLoadDeploymentTarget,
    unsupportedDslNodes,
  }
}
