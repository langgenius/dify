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
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { environmentId } from '../../environment'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { releaseDeploymentAction } from '../../release-action'
import { isAvailableDeploymentTarget } from '../../runtime-status'
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
import {
  DeployFormHeader,
  DeployFormSkeleton,
  DeploymentBindingsSection,
  EnvironmentField,

  ReleaseField,
} from './form-sections'
import {
  currentReleaseIdForEnvironment,
  selectableDeployReleases,
} from './release-options'

type DeployFormProps = {
  appInstanceId: string
  lockedEnvId?: string
  presetReleaseId?: string
}

type DeployReadyFormProps = DeployFormProps & {
  environments: EnvironmentOption[]
  releases: Release[]
  runtimeRows: EnvironmentDeployment[]
  defaultReleaseId?: string
  releaseEmptyLabel?: string
}

type BindingSelections = RuntimeCredentialBindingSelections

function DeployReadyForm({
  appInstanceId,
  environments,
  releases,
  runtimeRows,
  defaultReleaseId,
  releaseEmptyLabel,
  lockedEnvId,
  presetReleaseId,
}: DeployReadyFormProps) {
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
  const [manualBindings, setManualBindings] = useState<BindingSelections>({})
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

  const lockedEnv = lockedEnvId ? environments.find(e => e.id === lockedEnvId) : undefined
  const submitLabel = isSubmitting ? t('deployDrawer.deploying') : t('deployDrawer.deploy')

  function handleSelectRelease(releaseId: string) {
    setSelectedReleaseId(releaseId)
    setManualBindings({})
    setEnvVarValues({})
    setShowValidationErrors(false)
  }

  function handleSelectEnvironment(environmentId: string) {
    setSelectedEnvId(environmentId)
    setManualBindings({})
    setEnvVarValues({})
    setShowValidationErrors(false)
  }

  const handleDeploy = () => {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DeployFormHeader />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5">
          <ReleaseField
            displayedRelease={displayedRelease}
            emptyLabel={releaseEmptyLabel}
            isExistingRelease={isExistingRelease}
            releases={releases}
            selectedReleaseId={selectedReleaseId}
            onSelectRelease={handleSelectRelease}
          />

          <EnvironmentField
            environments={environments}
            lockedEnv={lockedEnv}
            lockedEnvId={lockedEnvId}
            selectedEnvironmentId={selectedEnvironmentId}
            onSelectEnvironment={handleSelectEnvironment}
          />

          {targetReleaseId && hasSelectedEnvironment && (
            <DeploymentBindingsSection
              bindingSlots={bindingSlots}
              bindingSelections={selectedBindings}
              bindingOptionsLoading={bindingOptionsLoading}
              bindingOptionsError={bindingOptionsError}
              envVarSlots={envVarSlots}
              envVarValues={effectiveEnvVarValues}
              showMissingRequiredBindings={showValidationErrors}
              showMissingRequiredEnvVars={showValidationErrors}
              onBindingChange={(slot, value) => setManualBindings(prev => ({ ...prev, [slot]: value }))}
              onEnvVarChange={(key: string, value: EnvVarValueSelection) => setEnvVarValues(prev => ({ ...prev, [key]: value }))}
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
        <Button type="button" variant="secondary" onClick={closeDeployDrawer}>
          {t('deployDrawer.cancel')}
        </Button>
        <Button variant="primary" disabled={!deployFormReady} onClick={handleDeploy}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

export function DeployForm({
  appInstanceId,
  lockedEnvId,
  presetReleaseId,
}: DeployFormProps) {
  const { t } = useTranslation('deployments')
  const releaseDeploymentViewQuery = useQuery(consoleQuery.enterprise.releaseService.getReleaseDeploymentView.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))

  if (releaseDeploymentViewQuery.isLoading) {
    return <DeployFormSkeleton />
  }

  if (releaseDeploymentViewQuery.isError) {
    return (
      <div className="p-4 system-sm-regular text-text-destructive">
        {t('common.loadFailed')}
      </div>
    )
  }

  const runtimeRows = releaseDeploymentViewQuery.data?.environmentDeployments ?? []
  const selectableEnvironmentRows = runtimeRows
    .filter(row => lockedEnvId ? Boolean(row.environment?.id) : isAvailableDeploymentTarget(row))
  const environments = selectableEnvironmentRows
    .map(row => row.environment)
    .filter((environment): environment is EnvironmentOption => Boolean(environment?.id))
  const releaseRows = releaseDeploymentViewQuery.data?.releases?.filter(release => release.id) ?? []
  const currentReleaseId = currentReleaseIdForEnvironment(runtimeRows, lockedEnvId)
  const releases = selectableDeployReleases({
    releases: releaseRows,
    lockedEnvId,
    currentReleaseId,
    presetReleaseId,
  })
  const defaultReleaseId = releases[0]?.id
  const releaseEmptyLabel = lockedEnvId && !presetReleaseId && currentReleaseId
    ? t('deployDrawer.noOtherReleaseAvailable')
    : undefined
  const formKey = `${appInstanceId}-${lockedEnvId ?? 'any'}-${presetReleaseId ?? 'new'}-${defaultReleaseId ?? 'none'}`

  return (
    <DeployReadyForm
      key={formKey}
      appInstanceId={appInstanceId}
      environments={environments}
      releases={releases}
      runtimeRows={runtimeRows}
      defaultReleaseId={defaultReleaseId}
      releaseEmptyLabel={releaseEmptyLabel}
      lockedEnvId={lockedEnvId}
      presetReleaseId={presetReleaseId}
    />
  )
}
