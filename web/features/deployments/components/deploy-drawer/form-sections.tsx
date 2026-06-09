'use client'

import type {
  CredentialSlot,
  Environment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type {
  DeploymentEnvVarSlot,
  EnvVarValues,
  EnvVarValueSelection,
} from '../env-var-bindings-utils'
import type { RuntimeCredentialBindingSelections } from '../runtime-credential-bindings-utils'
import { DrawerDescription, DrawerTitle } from '@langgenius/dify-ui/drawer'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { environmentBackend, environmentMode, environmentName } from '../../environment'
import { formatDate, releaseCommit, releaseLabel } from '../../release'
import { DeploymentStateMessage } from '../empty-state'
import { EnvVarBindingsPanel } from '../env-var-bindings'
import { RuntimeCredentialBindingsPanel } from '../runtime-credential-bindings'
import {
  DeploymentSelect,
  EnvironmentRow,
  Field,
} from './select'

export type EnvironmentOption = Environment & { id: string }

const DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME = 'max-h-none overflow-visible'

function environmentOptionLabel(env: EnvironmentOption, t: ReturnType<typeof useTranslation<'deployments'>>['t']) {
  const description = env.description?.trim()
  if (description)
    return `${environmentName(env)} · ${description}`

  return `${environmentName(env)} · ${t(environmentMode(env) === 'isolated' ? 'mode.isolated' : 'mode.shared')} · ${environmentBackend(env).toUpperCase()}`
}

function BindingOptionsPanel({
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

export function ReleaseField({
  displayedRelease,
  emptyLabel,
  isExistingRelease,
  releases,
  selectedReleaseId,
  onSelectRelease,
}: {
  displayedRelease?: Release
  emptyLabel?: string
  isExistingRelease: boolean
  releases: Release[]
  selectedReleaseId: string
  onSelectRelease: (releaseId: string) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <Field label={t('deployDrawer.releaseLabel')}>
      {isExistingRelease && displayedRelease
        ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between rounded-lg border border-components-panel-border bg-components-panel-bg-blur px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono system-sm-semibold text-text-primary">{releaseLabel(displayedRelease)}</span>
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
                onChange={onSelectRelease}
                options={releases.flatMap((release) => {
                  const releaseId = release.id
                  if (!releaseId)
                    return []

                  return [{
                    value: releaseId,
                    label: `${releaseLabel(release)} · ${releaseCommit(release)}`,
                  }]
                })}
                placeholder={t('deployDrawer.selectRelease')}
              />
            )}
    </Field>
  )
}

export function EnvironmentField({
  environments,
  lockedEnv,
  lockedEnvId,
  selectedEnvironmentId,
  onSelectEnvironment,
}: {
  environments: EnvironmentOption[]
  lockedEnv?: EnvironmentOption
  lockedEnvId?: string
  selectedEnvironmentId: string
  onSelectEnvironment: (environmentId: string) => void
}) {
  const { t } = useTranslation('deployments')

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
                onChange={onSelectEnvironment}
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

export function DeploymentBindingsSection({
  bindingSlots,
  bindingSelections,
  bindingOptionsLoading,
  bindingOptionsError,
  envVarSlots,
  envVarValues,
  showMissingRequiredBindings,
  showMissingRequiredEnvVars,
  onBindingChange,
  onEnvVarChange,
}: {
  bindingSlots: CredentialSlot[]
  bindingSelections: RuntimeCredentialBindingSelections
  bindingOptionsLoading: boolean
  bindingOptionsError: boolean
  envVarSlots: DeploymentEnvVarSlot[]
  envVarValues: EnvVarValues
  showMissingRequiredBindings: boolean
  showMissingRequiredEnvVars: boolean
  onBindingChange: (slot: string, value: string) => void
  onEnvVarChange: (key: string, value: EnvVarValueSelection) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <>
      <BindingOptionsPanel
        slots={bindingSlots}
        selections={bindingSelections}
        isLoading={bindingOptionsLoading}
        hasError={bindingOptionsError}
        bindingCountLabel={t('deployDrawer.bindingCount', { count: bindingSlots.length })}
        showMissingRequired={showMissingRequiredBindings}
        onChange={onBindingChange}
      />
      {!bindingOptionsLoading && !bindingOptionsError && (
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
          envVarCountLabel={t('deployDrawer.envVarCount', { count: envVarSlots.length })}
          missingRequiredLabel={t('deployDrawer.missingRequiredEnvVar')}
          listClassName={DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME}
          showMissingRequired={showMissingRequiredEnvVars}
          onChange={onEnvVarChange}
        />
      )}
    </>
  )
}
