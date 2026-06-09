'use client'

import type {
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvironmentOption } from './form-sections'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { isAvailableDeploymentTarget } from '../../runtime-status'
import { closeDeployDrawerAtom } from '../../store'
import {
  DeployFormHeader,
  DeploymentBindingsSection,
  EnvironmentField,
  ReleaseField,
} from './form-sections'
import { DeployFormSkeleton } from './form-skeleton'
import {
  currentReleaseIdForEnvironment,
  selectableDeployReleases,
} from './release-options'
import { useDeployReadyForm } from './use-deploy-ready-form'

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
  const lockedEnv = lockedEnvId ? environments.find(e => e.id === lockedEnvId) : undefined
  const {
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
    submitLabel,
    targetReleaseId,
  } = useDeployReadyForm({
    appInstanceId,
    environments,
    releases,
    runtimeRows,
    defaultReleaseId,
    lockedEnvId,
    presetReleaseId,
  })

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
              onBindingChange={handleBindingChange}
              onEnvVarChange={handleEnvVarChange}
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
  const environments = runtimeRows.flatMap((row): EnvironmentOption[] => {
    if (!lockedEnvId && !isAvailableDeploymentTarget(row))
      return []

    const environment = row.environment
    const environmentId = environment?.id
    if (!environment || !environmentId)
      return []

    return [{
      ...environment,
      id: environmentId,
    }]
  })
  const releaseRows = releaseDeploymentViewQuery.data?.releases?.flatMap((release) => {
    const releaseId = release.id
    if (!releaseId)
      return []

    return [{
      ...release,
      id: releaseId,
    }]
  }) ?? []
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
