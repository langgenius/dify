'use client'

import type {
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvironmentOption } from './use-deploy-ready-form'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { isAvailableDeploymentTarget } from '../../runtime-status'
import { closeDeployDrawerAtom } from '../../store'
import { EnvVarBindingsPanel } from '../env-var-bindings'
import {
  BindingOptionsPanel,
  DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME,
  DeployFormHeader,
  EnvironmentField,
  ReleaseField,
} from './form-sections'
import { DeployFormSkeleton } from './form-skeleton'
import {
  currentReleaseIdForEnvironment,
  selectableDeployReleases,
} from './release-options'
import {
  deployHasSelectedEnvironmentAtom,
  deployReadyFormConfigAtom,
  deployReadyFormLocalAtoms,
  deploySelectedEnvironmentAtom,
  deploySelectedEnvironmentIdAtom,
  deployTargetReleaseIdAtom,
  showDeployValidationErrorsAtom,
  useDeployBindings,
  useDeployReleaseSubmission,
  useReleaseDeploymentOptions,
} from './use-deploy-ready-form'

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

function DeployRuntimeCredentialBindingsSection() {
  const { t } = useTranslation('deployments')
  const deploymentOptions = useReleaseDeploymentOptions()
  const deploymentBindings = useDeployBindings({
    bindingSlots: deploymentOptions.bindingSlots,
    envVarSlots: deploymentOptions.envVarSlots,
  })

  return (
    <BindingOptionsPanel
      slots={deploymentOptions.bindingSlots}
      selections={deploymentBindings.selectedBindings}
      isLoading={deploymentOptions.isBindingOptionsLoading}
      hasError={deploymentOptions.hasBindingOptionsError}
      bindingCountLabel={t('deployDrawer.bindingCount', { count: deploymentOptions.bindingSlots.length })}
      showMissingRequired={deploymentBindings.showValidationErrors}
      onChange={deploymentBindings.handleBindingChange}
    />
  )
}

function DeployEnvVarBindingsSection() {
  const { t } = useTranslation('deployments')
  const deploymentOptions = useReleaseDeploymentOptions()
  const deploymentBindings = useDeployBindings({
    bindingSlots: deploymentOptions.bindingSlots,
    envVarSlots: deploymentOptions.envVarSlots,
  })

  if (deploymentOptions.isBindingOptionsLoading || deploymentOptions.hasBindingOptionsError)
    return null

  return (
    <EnvVarBindingsPanel
      slots={deploymentOptions.envVarSlots}
      values={deploymentBindings.envVarValues}
      title={t('deployDrawer.envVars')}
      hint={t('deployDrawer.envVarHint')}
      envVarPlaceholder={t('deployDrawer.envVarPlaceholder')}
      literalSourceLabel={t('deployDrawer.envVarSource.literal')}
      defaultSourceLabel={t('deployDrawer.envVarSource.default')}
      lastDeploymentSourceLabel={t('deployDrawer.envVarSource.lastDeployment')}
      valueTypeLabels={{
        string: t('deployDrawer.envVarType.string'),
        number: t('deployDrawer.envVarType.number'),
        secret: t('deployDrawer.envVarType.secret'),
      }}
      sourceAriaLabel={key => t('deployDrawer.envVarSource.ariaLabel', { key })}
      defaultSourcePriority="lastDeployment"
      envVarCountLabel={t('deployDrawer.envVarCount', { count: deploymentOptions.envVarSlots.length })}
      missingRequiredLabel={t('deployDrawer.missingRequiredEnvVar')}
      listClassName={DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME}
      showMissingRequired={deploymentBindings.showValidationErrors}
      onChange={deploymentBindings.handleEnvVarChange}
    />
  )
}

function DeployBindingsSection() {
  const targetReleaseId = useAtomValue(deployTargetReleaseIdAtom)
  const hasSelectedEnvironment = useAtomValue(deployHasSelectedEnvironmentAtom)

  if (!targetReleaseId || !hasSelectedEnvironment)
    return null

  return (
    <>
      <DeployRuntimeCredentialBindingsSection />
      <DeployEnvVarBindingsSection />
    </>
  )
}

function DeployFormBody() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div className="flex flex-col gap-5">
        <ReleaseField />
        <EnvironmentField />
        <DeployBindingsSection />
      </div>
    </div>
  )
}

function DeployFooter() {
  const { t } = useTranslation('deployments')
  const closeDeployDrawer = useSetAtom(closeDeployDrawerAtom)
  const selectedEnvironmentId = useAtomValue(deploySelectedEnvironmentIdAtom)
  const selectedEnvironment = useAtomValue(deploySelectedEnvironmentAtom)
  const targetReleaseId = useAtomValue(deployTargetReleaseIdAtom)
  const showValidationErrors = useSetAtom(showDeployValidationErrorsAtom)
  const deploymentOptions = useReleaseDeploymentOptions()
  const deploymentBindings = useDeployBindings({
    bindingSlots: deploymentOptions.bindingSlots,
    envVarSlots: deploymentOptions.envVarSlots,
  })
  const submission = useDeployReleaseSubmission({
    deploymentCredentials: deploymentBindings.deploymentCredentials,
    deploymentEnvVars: deploymentBindings.deploymentEnvVars,
  })
  const canAttemptDeploy = Boolean(
    selectedEnvironmentId
    && selectedEnvironment
    && targetReleaseId
    && deploymentOptions.isBindingOptionsReady
    && !submission.isSubmitting,
  )
  const canDeploy = Boolean(
    canAttemptDeploy
    && deploymentBindings.requiredBindingsReady
    && deploymentBindings.requiredEnvVarsReady,
  )
  const submitLabel = submission.isSubmitting ? t('deployDrawer.deploying') : t('deployDrawer.deploy')

  function handleDeploy() {
    showValidationErrors()

    if (!canDeploy)
      return

    submission.deployRelease()
  }

  return (
    <div className="flex shrink-0 justify-end gap-2 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
      <Button type="button" variant="secondary" onClick={closeDeployDrawer}>
        {t('deployDrawer.cancel')}
      </Button>
      <Button variant="primary" disabled={!canAttemptDeploy} onClick={handleDeploy}>
        {submitLabel}
      </Button>
    </div>
  )
}

function deployReadyFormStoreKey({
  appInstanceId,
  environments,
  releases,
  runtimeRows,
  defaultReleaseId,
  lockedEnvId,
  presetReleaseId,
}: DeployReadyFormProps) {
  return [
    appInstanceId,
    lockedEnvId ?? 'any',
    presetReleaseId ?? 'new',
    defaultReleaseId ?? 'none',
    environments.map(env => env.id).join(','),
    releases.map(release => release.id ?? '').join(','),
    runtimeRows.map(row => `${row.environment?.id ?? ''}:${row.currentRelease?.id ?? ''}`).join(','),
  ].join('|')
}

function DeployReadyForm(config: DeployReadyFormProps) {
  return (
    <ScopeProvider
      atoms={[
        [deployReadyFormConfigAtom, config],
        ...deployReadyFormLocalAtoms,
      ]}
      name="DeployReadyForm"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <DeployFormHeader />
        <DeployFormBody />
        <DeployFooter />
      </div>
    </ScopeProvider>
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
  const readyFormConfig = {
    appInstanceId,
    environments,
    releases,
    runtimeRows,
    defaultReleaseId,
    releaseEmptyLabel,
    lockedEnvId,
    presetReleaseId,
  }
  const formKey = deployReadyFormStoreKey(readyFormConfig)

  return (
    <DeployReadyForm
      key={formKey}
      {...readyFormConfig}
    />
  )
}
