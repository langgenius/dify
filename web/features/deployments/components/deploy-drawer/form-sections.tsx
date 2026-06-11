'use client'

import type { CredentialSlot, Environment } from '@dify/contracts/enterprise/types.gen'
import type { RuntimeCredentialBindingSelections } from '../runtime-credential-bindings-utils'
import { DrawerDescription, DrawerTitle } from '@langgenius/dify-ui/drawer'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { formatDate, releaseCommit } from '../../release'
import { DeploymentStateMessage } from '../empty-state'
import { RuntimeCredentialBindingsPanel } from '../runtime-credential-bindings'
import {
  DeploymentSelect,
  EnvironmentRow,
  Field,
} from './select'
import {
  useDeployEnvironmentField,
  useDeployReleaseField,
} from './use-deploy-ready-form'

export const DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME = 'max-h-none overflow-visible'

function environmentOptionLabel(env: Environment, t: ReturnType<typeof useTranslation<'deployments'>>['t']) {
  const description = env.description.trim()
  if (description)
    return `${env.displayName} · ${description}`

  return `${env.displayName} · ${t(`mode.${env.mode}`)} · ${t(`backend.${env.backend}`)}`
}

export function BindingOptionsPanel({
  slots,
  selections,
  isLoading,
  hasError,
  bindingCountLabel,
  showMissingRequired,
  onChange,
}: {
  slots: CredentialSlot[]
  selections: RuntimeCredentialBindingSelections
  isLoading: boolean
  hasError: boolean
  bindingCountLabel: string
  showMissingRequired: boolean
  onChange: (slot: string, value: string) => void
}) {
  const { t } = useTranslation('deployments')

  if (isLoading) {
    return (
      <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-4">
        <SkeletonContainer className="gap-2">
          <SkeletonRectangle className="h-3 w-32 animate-pulse" />
          <SkeletonRectangle className="h-3 w-2/3 animate-pulse" />
          <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
        </SkeletonContainer>
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-4 system-sm-regular text-text-destructive">
        {t('deployDrawer.bindingOptionsFailed')}
      </div>
    )
  }

  return (
    <RuntimeCredentialBindingsPanel
      slots={slots}
      selections={selections}
      title={t('deployDrawer.runtimeCredentials')}
      hint={t('deployDrawer.bindingSelectionHint')}
      noBindingRequiredLabel={t('deployDrawer.noBindingRequired')}
      noCredentialCandidatesLabel={t('deployDrawer.noCredentialCandidates')}
      selectCredentialLabel={t('deployDrawer.selectCredential')}
      missingRequiredLabel={t('deployDrawer.missingRequiredBinding')}
      bindingCountLabel={bindingCountLabel}
      showMissingRequired={showMissingRequired}
      listClassName={DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME}
      onChange={onChange}
    />
  )
}

export function DeployFormHeader() {
  const { t } = useTranslation('deployments')

  return (
    <div className="shrink-0 border-b border-divider-subtle px-6 py-5 pr-14">
      <DrawerTitle className="title-xl-semi-bold text-text-primary">
        {t('deployDrawer.title')}
      </DrawerTitle>
      <DrawerDescription className="mt-1 system-sm-regular text-text-tertiary">
        {t('deployDrawer.description')}
      </DrawerDescription>
    </div>
  )
}

export function ReleaseField() {
  const { t } = useTranslation('deployments')
  const {
    displayedRelease,
    emptyLabel,
    isExistingRelease,
    releases,
    selectedReleaseId,
    selectRelease,
  } = useDeployReleaseField()

  return (
    <Field label={t('deployDrawer.releaseLabel')}>
      {isExistingRelease && displayedRelease
        ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between rounded-lg border border-components-panel-border bg-components-panel-bg-blur px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono system-sm-semibold text-text-primary">{displayedRelease.displayName}</span>
                  <span className="shrink-0 system-xs-regular text-text-tertiary">·</span>
                  <span className="shrink-0 font-mono system-xs-regular text-text-tertiary">{releaseCommit(displayedRelease)}</span>
                </div>
                <span className="shrink-0 system-xs-regular text-text-quaternary">{formatDate(displayedRelease.createdAt)}</span>
              </div>
              <span className="system-xs-regular text-text-tertiary">
                {t('deployDrawer.existingReleaseHint')}
              </span>
            </div>
          )
        : releases.length === 0
          ? (
              <DeploymentStateMessage variant="compact">
                {emptyLabel ?? t('deployDrawer.noReleaseAvailable')}
              </DeploymentStateMessage>
            )
          : (
              <DeploymentSelect
                value={selectedReleaseId}
                onChange={selectRelease}
                options={releases.map(release => ({
                  value: release.id,
                  label: `${release.displayName} · ${releaseCommit(release)}`,
                }))}
                placeholder={t('deployDrawer.selectRelease')}
              />
            )}
    </Field>
  )
}

export function EnvironmentField() {
  const { t } = useTranslation('deployments')
  const {
    environments,
    lockedEnv,
    lockedEnvId,
    selectedEnvironmentId,
    selectEnvironment,
  } = useDeployEnvironmentField()

  return (
    <Field
      label={t('deployDrawer.targetEnv')}
      hint={lockedEnvId ? t('deployDrawer.lockedHint') : undefined}
    >
      {lockedEnv
        ? <EnvironmentRow env={lockedEnv} />
        : environments.length === 0
          ? (
              <DeploymentStateMessage variant="compact">
                {t('deployDrawer.noNewEnvironmentAvailable')}
              </DeploymentStateMessage>
            )
          : (
              <DeploymentSelect
                value={selectedEnvironmentId}
                onChange={selectEnvironment}
                options={environments.map(env => ({
                  value: env.id,
                  label: environmentOptionLabel(env, t),
                }))}
                placeholder={t('deployDrawer.selectEnv')}
              />
            )}
    </Field>
  )
}
