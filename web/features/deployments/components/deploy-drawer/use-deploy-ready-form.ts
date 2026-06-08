'use client'

import type {
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type {
  EnvVarValues,
  EnvVarValueSelection,
} from '../env-var-bindings-utils'
import type { RuntimeCredentialBindingSelections } from '../runtime-credential-bindings-utils'
import type { EnvironmentOption } from './form-sections'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { environmentId } from '../../environment'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { releaseDeploymentAction } from '../../release-action'
import { closeDeployDrawerAtom } from '../../store'
import {
  envVarSlotsWithoutDefaultValues,
  envVarValuesWithDefaults,
  hasEnvVarSlotKey,
  hasMissingRequiredEnvVarValue,
  selectedDeploymentEnvVars,
} from '../env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../runtime-credential-bindings-utils'

type UseDeployReadyFormParams = {
  appInstanceId: string
  environments: EnvironmentOption[]
  releases: Release[]
  runtimeRows: EnvironmentDeployment[]
  defaultReleaseId?: string
  lockedEnvId?: string
  presetReleaseId?: string
}

export function useDeployReadyForm({
  appInstanceId,
  environments,
  releases,
  runtimeRows,
  defaultReleaseId,
  lockedEnvId,
  presetReleaseId,
}: UseDeployReadyFormParams) {
  const { t } = useTranslation('deployments')
  const closeDeployDrawer = useSetAtom(closeDeployDrawerAtom)
  const promoteRelease = useMutation(consoleQuery.enterprise.deploymentService.promote.mutationOptions())
  const rollbackRelease = useMutation(consoleQuery.enterprise.deploymentService.rollback.mutationOptions())
  const presetRelease = presetReleaseId ? releases.find(r => r.id === presetReleaseId) : undefined
  const displayedRelease: Release | undefined = presetRelease ?? (presetReleaseId ? { id: presetReleaseId } : undefined)
  const isExistingRelease = Boolean(presetReleaseId)

  const [selectedEnvId, setSelectedEnvId] = useState<string>(
    () => lockedEnvId ?? environments[0]?.id ?? '',
  )
  const selectedEnvironmentId = selectedEnvId || lockedEnvId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => env.id === selectedEnvironmentId)
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>(
    () => displayedRelease?.id ?? defaultReleaseId ?? '',
  )
  const selectedRelease = releases.find(release => release.id === selectedReleaseId)
  const targetRelease = displayedRelease ?? selectedRelease
  const targetReleaseId = targetRelease?.id ?? selectedReleaseId
  const hasSelectedEnvironment = Boolean(selectedEnvironmentId && selectedEnvironment)
  const shouldLoadBindingOptions = Boolean(appInstanceId && targetReleaseId && hasSelectedEnvironment)
  const bindingOptions = useQuery(consoleQuery.enterprise.releaseService.listReleaseCredentialCandidates.queryOptions({
    input: shouldLoadBindingOptions
      ? {
          params: {
            releaseId: targetReleaseId,
          },
        }
      : skipToken,
  }))
  const shouldLoadDeploymentOptions = Boolean(targetReleaseId && selectedEnvironmentId && hasSelectedEnvironment)
  const deploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getReleaseDeploymentOptions.queryOptions({
      input: shouldLoadDeploymentOptions
        ? {
            params: {
              releaseId: targetReleaseId,
            },
            query: {
              environmentId: selectedEnvironmentId,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const deploymentOptionCredentialSlots = deploymentOptionsQuery.data?.options?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
  const credentialCandidateSlots = bindingOptions.data?.slots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
  const bindingSlots = deploymentOptionCredentialSlots.length > 0 ? deploymentOptionCredentialSlots : credentialCandidateSlots
  const deploymentOptionEnvVarSourceSlots = deploymentOptionsQuery.data?.options?.envVarSlots
  const deploymentOptionEnvVarSlots = envVarSlotsWithoutDefaultValues(deploymentOptionEnvVarSourceSlots?.filter(hasEnvVarSlotKey) ?? [])
  const envVarSlots = deploymentOptionEnvVarSlots
  const [manualBindings, setManualBindings] = useState<RuntimeCredentialBindingSelections>({})
  const [envVarValues, setEnvVarValues] = useState<EnvVarValues>({})
  const [showValidationErrors, setShowValidationErrors] = useState(false)
  const effectiveEnvVarValues = envVarValuesWithDefaults(envVarValues, envVarSlots)
  const selectedBindings = selectedRuntimeCredentialSelections(bindingSlots, manualBindings)
  const deploymentCredentials = selectedDeploymentRuntimeCredentials(bindingSlots, selectedBindings)
  const deploymentEnvVars = selectedDeploymentEnvVars(envVarSlots, effectiveEnvVarValues)
  const bindingOptionsLoading = Boolean(
    targetReleaseId
    && hasSelectedEnvironment
    && (
      bindingOptions.isLoading
      || bindingOptions.isFetching
      || deploymentOptionsQuery.isLoading
      || deploymentOptionsQuery.isFetching
    ),
  )
  const bindingOptionsError = Boolean(bindingOptions.isError || deploymentOptionsQuery.isError)
  const bindingOptionsReady = Boolean(
    targetReleaseId
    && hasSelectedEnvironment
    && (bindingOptions.data || deploymentOptionsQuery.data)
    && !bindingOptionsLoading
    && !bindingOptionsError,
  )
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredRuntimeCredentialBinding(slot, selectedBindings[runtimeCredentialSlotKey(slot)]))
  const requiredEnvVarsReady = envVarSlots.every(slot => !hasMissingRequiredEnvVarValue(slot, effectiveEnvVarValues))
  const isSubmitting = promoteRelease.isPending || rollbackRelease.isPending
  const deployFormReady = Boolean(
    selectedEnvironmentId
    && selectedEnvironment
    && targetReleaseId
    && bindingOptionsReady
    && !isSubmitting,
  )
  const canDeploy = Boolean(
    deployFormReady
    && requiredBindingsReady
    && requiredEnvVarsReady,
  )

  function resetBindingSelections() {
    setManualBindings({})
    setEnvVarValues({})
    setShowValidationErrors(false)
  }

  function handleSelectRelease(releaseId: string) {
    setSelectedReleaseId(releaseId)
    resetBindingSelections()
  }

  function handleSelectEnvironment(environmentId: string) {
    setSelectedEnvId(environmentId)
    resetBindingSelections()
  }

  function handleBindingChange(slot: string, value: string) {
    setManualBindings(prev => ({ ...prev, [slot]: value }))
  }

  function handleEnvVarChange(key: string, value: EnvVarValueSelection) {
    setEnvVarValues(prev => ({ ...prev, [key]: value }))
  }

  function handleDeploy() {
    setShowValidationErrors(true)

    if (!canDeploy || !targetReleaseId)
      return

    const idempotencyKey = createDeploymentIdempotencyKey()
    const currentRelease = runtimeRows.find(row => environmentId(row.environment) === selectedEnvironmentId)?.currentRelease
    const action = releaseDeploymentAction({
      targetRelease,
      currentRelease,
      releaseRows: releases,
      isExistingRelease: true,
    })
    const mutationOptions = {
      onSuccess: () => {
        closeDeployDrawer()
      },
      onError: () => {
        toast.error(t('deployDrawer.deployFailed'))
      },
    }

    if (action === 'rollback') {
      rollbackRelease.mutate(
        {
          params: {
            appInstanceId,
            environmentId: selectedEnvironmentId,
          },
          body: {
            appInstanceId,
            environmentId: selectedEnvironmentId,
            targetReleaseId,
            idempotencyKey,
          },
        },
        mutationOptions,
      )
      return
    }

    promoteRelease.mutate(
      {
        params: {
          appInstanceId,
          environmentId: selectedEnvironmentId,
        },
        body: {
          appInstanceId,
          environmentId: selectedEnvironmentId,
          releaseId: targetReleaseId,
          credentials: deploymentCredentials,
          envVars: deploymentEnvVars.length > 0 ? deploymentEnvVars : undefined,
          idempotencyKey,
        },
      },
      mutationOptions,
    )
  }

  return {
    bindingOptionsError,
    bindingOptionsLoading,
    bindingSlots,
    deployFormReady,
    displayedRelease,
    effectiveEnvVarValues,
    envVarSlots,
    handleBindingChange,
    handleDeploy,
    handleEnvVarChange,
    handleSelectEnvironment,
    handleSelectRelease,
    hasSelectedEnvironment,
    isExistingRelease,
    selectedBindings,
    selectedEnvironmentId,
    selectedReleaseId,
    showValidationErrors,
    submitLabel: isSubmitting ? t('deployDrawer.deploying') : t('deployDrawer.deploy'),
    targetReleaseId,
  }
}
