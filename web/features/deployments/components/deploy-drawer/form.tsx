'use client'

import type {
  EnvVarSlot,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarValues } from '../env-var-bindings-utils'
import type { RuntimeCredentialBindingSelections } from '../runtime-credential-bindings-utils'
import type { EnvironmentOption } from './form-sections'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { DEPLOYMENT_PAGE_SIZE } from '../../data'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { isAvailableDeploymentTarget } from '../../runtime-status'
import { closeDeployDrawerAtom } from '../../store'
import {
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

type DeployFormProps = {
  appInstanceId: string
  lockedEnvId?: string
  presetReleaseId?: string
}

type DeployReadyFormProps = DeployFormProps & {
  environments: EnvironmentOption[]
  releases: Release[]
  defaultReleaseId?: string
}

type BindingSelections = RuntimeCredentialBindingSelections

function requiredSlotEnvVarSlot(slot: NonNullable<Release['requiredSlots']>[number]): EnvVarSlot | undefined {
  if (slot.type !== 'SLOT_TYPE_ENV_VAR')
    return undefined

  const key = slot.name?.trim()
  return key ? { key } : undefined
}

function DeployReadyForm({
  appInstanceId,
  environments,
  releases,
  defaultReleaseId,
  lockedEnvId,
  presetReleaseId,
}: DeployReadyFormProps) {
  const { t } = useTranslation('deployments')
  const closeDeployDrawer = useSetAtom(closeDeployDrawerAtom)
  const startDeploy = useMutation(consoleQuery.enterprise.deploymentService.deploy.mutationOptions())
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
  const bindingSlots = bindingOptions.data?.slots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
  const envVarSlots = targetRelease?.requiredSlots
    ?.map(requiredSlotEnvVarSlot)
    .filter((slot): slot is EnvVarSlot => hasEnvVarSlotKey(slot)) ?? []
  const [manualBindings, setManualBindings] = useState<BindingSelections>({})
  const [envVarValues, setEnvVarValues] = useState<EnvVarValues>({})
  const selectedBindings = selectedRuntimeCredentialSelections(bindingSlots, manualBindings)
  const deploymentCredentials = selectedDeploymentRuntimeCredentials(bindingSlots, selectedBindings)
  const deploymentEnvVars = selectedDeploymentEnvVars(envVarSlots, envVarValues)
  const bindingOptionsLoading = Boolean(targetReleaseId && hasSelectedEnvironment && (bindingOptions.isLoading || bindingOptions.isFetching))
  const bindingOptionsReady = Boolean(targetReleaseId && hasSelectedEnvironment && bindingOptions.data && !bindingOptionsLoading && !bindingOptions.isError)
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredRuntimeCredentialBinding(slot, selectedBindings[runtimeCredentialSlotKey(slot)]))
  const requiredEnvVarsReady = envVarSlots.every(slot => !hasMissingRequiredEnvVarValue(slot, envVarValues))
  const isSubmitting = startDeploy.isPending
  const canDeploy = Boolean(
    selectedEnvironmentId
    && selectedEnvironment
    && targetReleaseId
    && bindingOptionsReady
    && requiredBindingsReady
    && requiredEnvVarsReady
    && !isSubmitting,
  )

  const lockedEnv = lockedEnvId ? environments.find(e => e.id === lockedEnvId) : undefined
  const submitLabel = isSubmitting ? t('deployDrawer.deploying') : t('deployDrawer.deploy')

  const handleDeploy = () => {
    if (!canDeploy || !targetReleaseId)
      return

    const idempotencyKey = createDeploymentIdempotencyKey()
    startDeploy.mutate(
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
      {
        onSuccess: () => {
          closeDeployDrawer()
        },
        onError: () => {
          toast.error(t('deployDrawer.deployFailed'))
        },
      },
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DeployFormHeader />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5">
          <ReleaseField
            displayedRelease={displayedRelease}
            isExistingRelease={isExistingRelease}
            releases={releases}
            selectedReleaseId={selectedReleaseId}
            onSelectRelease={setSelectedReleaseId}
          />

          <EnvironmentField
            environments={environments}
            lockedEnv={lockedEnv}
            lockedEnvId={lockedEnvId}
            selectedEnvironmentId={selectedEnvironmentId}
            onSelectEnvironment={setSelectedEnvId}
          />

          {targetReleaseId && hasSelectedEnvironment && (
            <DeploymentBindingsSection
              bindingSlots={bindingSlots}
              bindingSelections={selectedBindings}
              bindingOptionsLoading={bindingOptionsLoading}
              bindingOptionsError={bindingOptions.isError}
              envVarSlots={envVarSlots}
              envVarValues={envVarValues}
              onBindingChange={(slot, value) => setManualBindings(prev => ({ ...prev, [slot]: value }))}
              onEnvVarChange={(key, value) => setEnvVarValues(prev => ({ ...prev, [key]: value }))}
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
        <Button type="button" variant="secondary" onClick={closeDeployDrawer}>
          {t('deployDrawer.cancel')}
        </Button>
        <Button variant="primary" disabled={!canDeploy} onClick={handleDeploy}>
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
  const releaseHistoryQuery = useQuery(consoleQuery.enterprise.releaseService.listReleases.queryOptions({
    input: {
      params: { appInstanceId },
      query: {
        pageNumber: 1,
        resultsPerPage: DEPLOYMENT_PAGE_SIZE,
      },
    },
  }))
  const runtimeInstancesQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))

  if (releaseHistoryQuery.isLoading || runtimeInstancesQuery.isLoading) {
    return <DeployFormSkeleton />
  }

  if (releaseHistoryQuery.isError || runtimeInstancesQuery.isError) {
    return (
      <div className="p-4 system-sm-regular text-text-destructive">
        {t('common.loadFailed')}
      </div>
    )
  }

  const runtimeRows = runtimeInstancesQuery.data?.data ?? []
  const selectableEnvironmentRows = runtimeRows
    .filter(row => lockedEnvId ? Boolean(row.environment?.id) : isAvailableDeploymentTarget(row))
  const environments = selectableEnvironmentRows
    .map(row => row.environment)
    .filter((environment): environment is EnvironmentOption => Boolean(environment?.id))
  const releases = releaseHistoryQuery.data?.data?.filter(release => release.id) ?? []
  const defaultReleaseId = releases[0]?.id
  const formKey = `${appInstanceId}-${lockedEnvId ?? 'any'}-${presetReleaseId ?? 'new'}-${defaultReleaseId ?? 'none'}`

  return (
    <DeployReadyForm
      key={formKey}
      appInstanceId={appInstanceId}
      environments={environments}
      releases={releases}
      defaultReleaseId={defaultReleaseId}
      lockedEnvId={lockedEnvId}
      presetReleaseId={presetReleaseId}
    />
  )
}
