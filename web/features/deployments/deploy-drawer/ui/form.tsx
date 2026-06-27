'use client'

import type {
  Environment,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { EnvVarBindingsPanel } from '../../shared/components/env-var-bindings'
import { isAvailableDeploymentTarget } from '../../shared/domain/runtime-status'
import { canAttemptDeployAtom, canSubmitDeployAtom, closeDeployDrawerAtom, deployBindingSlotsAtom, deployEnvVarSlotsAtom, deployEnvVarValuesAtom, deployFormAppInstanceIdAtom, deployHasBindingOptionsErrorAtom, deployHasSelectedEnvironmentAtom, deployIsBindingOptionsLoadingAtom, deployReadyFormConfigAtom, deployReadyFormLocalAtoms, deployReleaseSubmissionAtom, deploySelectedBindingsAtom, deployShowValidationErrorsAtom, deployTargetReleaseIdAtom, isDeployReleaseSubmittingAtom, releaseDeploymentViewQueryAtom, selectDeployBindingAtom, setDeployEnvVarAtom, showDeployValidationErrorsAtom } from '../state'
import {
  currentReleaseIdForEnvironment,
  selectableDeployReleases,
} from '../state/release-options'
import {
  BindingOptionsPanel,
  DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME,
  DeployFormHeader,
  EnvironmentField,
  ReleaseField,
} from './form-sections'
import { DeployFormSkeleton } from './form-skeleton'

type DeployFormProps = {
  appInstanceId: string
  lockedEnvId?: string
  presetReleaseId?: string
}

type DeployReadyFormProps = DeployFormProps & {
  environments: Environment[]
  releases: Release[]
  runtimeRows: EnvironmentDeployment[]
  defaultReleaseId?: string
  releaseEmptyLabel?: string
}

function DeployRuntimeCredentialBindingsSection() {
  const { t } = useTranslation('deployments')
  const bindingSlots = useAtomValue(deployBindingSlotsAtom)
  const selectedBindings = useAtomValue(deploySelectedBindingsAtom)
  const isBindingOptionsLoading = useAtomValue(deployIsBindingOptionsLoadingAtom)
  const hasBindingOptionsError = useAtomValue(deployHasBindingOptionsErrorAtom)
  const showValidationErrors = useAtomValue(deployShowValidationErrorsAtom)
  const selectBinding = useSetAtom(selectDeployBindingAtom)

  return (
    <BindingOptionsPanel
      slots={bindingSlots}
      selections={selectedBindings}
      isLoading={isBindingOptionsLoading}
      hasError={hasBindingOptionsError}
      bindingCountLabel={t('deployDrawer.bindingCount', { count: bindingSlots.length })}
      showMissingRequired={showValidationErrors}
      onChange={selectBinding}
    />
  )
}

function DeployEnvVarBindingsSection() {
  const { t } = useTranslation('deployments')
  const envVarSlots = useAtomValue(deployEnvVarSlotsAtom)
  const envVarValues = useAtomValue(deployEnvVarValuesAtom)
  const isBindingOptionsLoading = useAtomValue(deployIsBindingOptionsLoadingAtom)
  const hasBindingOptionsError = useAtomValue(deployHasBindingOptionsErrorAtom)
  const showValidationErrors = useAtomValue(deployShowValidationErrorsAtom)
  const setDeployEnvVar = useSetAtom(setDeployEnvVarAtom)

  if (isBindingOptionsLoading || hasBindingOptionsError)
    return null

  return (
    <EnvVarBindingsPanel
      slots={envVarSlots}
      values={envVarValues}
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
      envVarCountLabel={t('deployDrawer.envVarCount', { count: envVarSlots.length })}
      missingRequiredLabel={t('deployDrawer.missingRequiredEnvVar')}
      listClassName={DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME}
      showMissingRequired={showValidationErrors}
      onChange={setDeployEnvVar}
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
  const showValidationErrors = useSetAtom(showDeployValidationErrorsAtom)
  const submitDeployRelease = useSetAtom(deployReleaseSubmissionAtom)
  const canAttemptDeploy = useAtomValue(canAttemptDeployAtom)
  const canDeploy = useAtomValue(canSubmitDeployAtom)
  const isSubmitting = useAtomValue(isDeployReleaseSubmittingAtom)
  const submitLabel = isSubmitting ? t('deployDrawer.deploying') : t('deployDrawer.deploy')

  function handleDeploy() {
    showValidationErrors()

    if (!canDeploy)
      return

    submitDeployRelease({
      deployFailedMessage: t('deployDrawer.deployFailed'),
    })
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
    releases.map(release => release.id).join(','),
    runtimeRows.map(row => `${row.environment.id}:${row.currentRelease?.id ?? 'none'}`).join(','),
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

function DeployFormContent({
  appInstanceId,
  lockedEnvId,
  presetReleaseId,
}: DeployFormProps) {
  const { t } = useTranslation('deployments')
  const releaseDeploymentViewQuery = useAtomValue(releaseDeploymentViewQueryAtom)

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

  const deploymentView = releaseDeploymentViewQuery.data
  if (!deploymentView) {
    return (
      <div className="p-4 system-sm-regular text-text-destructive">
        {t('common.loadFailed')}
      </div>
    )
  }

  const runtimeRows = deploymentView.environmentDeployments
  const environments = runtimeRows
    .filter(row => lockedEnvId || isAvailableDeploymentTarget(row))
    .map(row => row.environment)
  const releaseRows = deploymentView.releases
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

export function DeployForm(props: DeployFormProps) {
  return (
    <ScopeProvider
      key={props.appInstanceId}
      atoms={[
        [deployFormAppInstanceIdAtom, props.appInstanceId],
      ]}
      name="DeployForm"
    >
      <DeployFormContent {...props} />
    </ScopeProvider>
  )
}
