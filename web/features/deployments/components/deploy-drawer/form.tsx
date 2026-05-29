'use client'

import type {
  CredentialSlot,
  Environment,
  EnvVarSlot,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarValues } from '../env-var-bindings-utils'
import type { RuntimeCredentialBindingSelections } from '../runtime-credential-bindings-utils'
import { Button } from '@langgenius/dify-ui/button'
import { DrawerDescription, DrawerTitle } from '@langgenius/dify-ui/drawer'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { DEPLOYMENT_PAGE_SIZE } from '../../data'
import { environmentBackend, environmentMode, environmentName } from '../../environment'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { formatDate, releaseCommit, releaseLabel } from '../../release'
import { isAvailableDeploymentTarget } from '../../runtime-status'
import { closeDeployDrawerAtom } from '../../store'
import {
  EnvVarBindingsPanel,
} from '../env-var-bindings'
import {
  hasEnvVarSlotKey,
  hasMissingRequiredEnvVarValue,
  selectedDeploymentEnvVars,
} from '../env-var-bindings-utils'
import {
  RuntimeCredentialBindingsPanel,
} from '../runtime-credential-bindings'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../runtime-credential-bindings-utils'
import {
  DeploymentSelect,
  EnvironmentRow,
  Field,
} from './select'

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

type EnvironmentOption = Environment & { id: string }

const DEPLOY_FORM_FIELD_SKELETON_KEYS = ['environment', 'release']
const DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME = 'max-h-none overflow-visible'

type BindingSelections = RuntimeCredentialBindingSelections

type BindingOptionsPanelProps = {
  slots: CredentialSlot[]
  selections: BindingSelections
  isLoading: boolean
  hasError: boolean
  bindingCountLabel: string
  onChange: (slot: string, value: string) => void
}

function environmentOptionLabel(env: EnvironmentOption, t: ReturnType<typeof useTranslation<'deployments'>>['t']) {
  const description = env.description?.trim()
  if (description)
    return `${environmentName(env)} · ${description}`

  return `${environmentName(env)} · ${t(environmentMode(env) === 'isolated' ? 'mode.isolated' : 'mode.shared')} · ${environmentBackend(env).toUpperCase()}`
}

function requiredSlotEnvVarSlot(slot: NonNullable<Release['requiredSlots']>[number]): EnvVarSlot | undefined {
  if (slot.type !== 'SLOT_TYPE_ENV_VAR')
    return undefined

  const key = slot.name?.trim()
  return key ? { key } : undefined
}

function BindingOptionsPanel({
  slots,
  selections,
  isLoading,
  hasError,
  bindingCountLabel,
  onChange,
}: BindingOptionsPanelProps) {
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
      requiredLabel={t('deployDrawer.requiredBinding')}
      noBindingRequiredLabel={t('deployDrawer.noBindingRequired')}
      noCredentialCandidatesLabel={t('deployDrawer.noCredentialCandidates')}
      selectCredentialLabel={t('deployDrawer.selectCredential')}
      missingRequiredLabel={t('deployDrawer.missingRequiredBinding')}
      bindingCountLabel={bindingCountLabel}
      listClassName={DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME}
      onChange={onChange}
    />
  )
}

function DeployFormSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-divider-subtle px-6 py-5 pr-14">
        <SkeletonContainer className="gap-2">
          <SkeletonRectangle className="h-5 w-44 animate-pulse" />
          <SkeletonRectangle className="h-3 w-72 animate-pulse" />
        </SkeletonContainer>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5">
          {DEPLOY_FORM_FIELD_SKELETON_KEYS.map(key => (
            <SkeletonContainer key={key} className="gap-2">
              <SkeletonRectangle className="h-3 w-24 animate-pulse" />
              <SkeletonRectangle className="my-0 h-9 w-full animate-pulse rounded-lg" />
            </SkeletonContainer>
          ))}

          <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-4">
            <SkeletonContainer className="gap-2">
              <SkeletonRectangle className="h-3 w-32 animate-pulse" />
              <SkeletonRectangle className="h-3 w-2/3 animate-pulse" />
              <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
            </SkeletonContainer>
          </div>
        </div>
      </div>

      <SkeletonRow className="shrink-0 justify-end border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
        <SkeletonRectangle className="my-0 h-8 w-18 animate-pulse rounded-lg" />
        <SkeletonRectangle className="my-0 h-8 w-22 animate-pulse rounded-lg" />
      </SkeletonRow>
    </div>
  )
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
  const bindingOptions = useQuery(consoleQuery.enterprise.releaseService.listReleaseCredentialCandidates.queryOptions({
    input: {
      params: {
        releaseId: targetReleaseId || '',
      },
    },
    enabled: Boolean(appInstanceId && targetReleaseId && hasSelectedEnvironment),
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
  const actionTitle = t('deployDrawer.title')
  const actionDescription = t('deployDrawer.description')
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
      <div className="shrink-0 border-b border-divider-subtle px-6 py-5 pr-14">
        <DrawerTitle className="title-xl-semi-bold text-text-primary">
          {actionTitle}
        </DrawerTitle>
        <DrawerDescription className="mt-1 system-sm-regular text-text-tertiary">
          {actionDescription}
        </DrawerDescription>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-5">
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
                    <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-3 py-3 system-sm-regular text-text-tertiary">
                      {t('deployDrawer.noReleaseAvailable')}
                    </div>
                  )
                : (
                    <DeploymentSelect
                      value={selectedReleaseId}
                      onChange={setSelectedReleaseId}
                      options={releases.filter(release => release.id).map(release => ({
                        value: release.id!,
                        label: `${releaseLabel(release)} · ${releaseCommit(release)}`,
                      }))}
                      placeholder={t('deployDrawer.selectRelease')}
                    />
                  )}
          </Field>

          <Field
            label={t('deployDrawer.targetEnv')}
            hint={lockedEnvId ? t('deployDrawer.lockedHint') : undefined}
          >
            {lockedEnv
              ? <EnvironmentRow env={lockedEnv} />
              : environments.length === 0
                ? (
                    <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-3 py-3 system-sm-regular text-text-tertiary">
                      {t('deployDrawer.noNewEnvironmentAvailable')}
                    </div>
                  )
                : (
                    <DeploymentSelect
                      value={selectedEnvironmentId}
                      onChange={setSelectedEnvId}
                      options={environments.filter(env => env.id).map(env => ({
                        value: env.id!,
                        label: environmentOptionLabel(env, t),
                      }))}
                      placeholder={t('deployDrawer.selectEnv')}
                    />
                  )}
          </Field>

          {targetReleaseId && hasSelectedEnvironment && (
            <>
              <BindingOptionsPanel
                slots={bindingSlots}
                selections={selectedBindings}
                isLoading={bindingOptionsLoading}
                hasError={bindingOptions.isError}
                bindingCountLabel={t('deployDrawer.bindingCount', { count: bindingSlots.length })}
                onChange={(slot, value) => setManualBindings(prev => ({ ...prev, [slot]: value }))}
              />
              {!bindingOptionsLoading && !bindingOptions.isError && (
                <EnvVarBindingsPanel
                  slots={envVarSlots}
                  values={envVarValues}
                  title={t('deployDrawer.envVars')}
                  hint={t('deployDrawer.envVarHint')}
                  requiredLabel={t('deployDrawer.requiredBinding')}
                  envVarPlaceholder={t('deployDrawer.envVarPlaceholder')}
                  envVarCountLabel={t('deployDrawer.envVarCount', { count: envVarSlots.length })}
                  missingRequiredLabel={t('deployDrawer.missingRequiredEnvVar')}
                  listClassName={DEPLOY_DRAWER_BINDING_LIST_CLASS_NAME}
                  showMissingRequired
                  onChange={(key, value) => setEnvVarValues(prev => ({ ...prev, [key]: value }))}
                />
              )}
            </>
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
