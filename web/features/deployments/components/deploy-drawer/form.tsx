'use client'

import type {
  CredentialSelectionInput,
  CredentialSlot,
  Environment,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { DEPLOYMENT_PAGE_SIZE } from '../../data'
import { environmentBackend, environmentId, environmentMode, environmentName } from '../../environment'
import { createDeploymentIdempotencyKey } from '../../idempotency'
import { releaseCommit, releaseLabel } from '../../release'
import { releaseDeploymentAction } from '../../release-action'
import { hasRuntimeInstanceDeployment, isAvailableDeploymentTarget } from '../../runtime-status'
import { closeDeployDrawerAtom } from '../../store'
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
  runtimeRows: EnvironmentDeployment[]
}

type EnvironmentOption = Environment & { id: string }

const DEPLOY_FORM_FIELD_SKELETON_KEYS = ['environment', 'release']

type BindingSelections = Record<string, string>

type BindingSelectOption = {
  value: string
  label: string
}

type BindingOptionsPanelProps = {
  slots: CredentialSlot[]
  selections: BindingSelections
  isLoading: boolean
  hasError: boolean
  onChange: (slot: string, value: string) => void
}

function credentialSlotKey(slot: CredentialSlot) {
  return [slot.providerId ?? '', slot.category ?? ''].join(':')
}

function bindingCandidateOptions(slot: CredentialSlot): BindingSelectOption[] {
  return (slot.candidates ?? [])
    .filter(candidate => candidate.credentialId)
    .map(candidate => ({
      value: candidate.credentialId!,
      label: [
        candidate.displayName,
        candidate.providerId,
      ].filter(Boolean).join(' · ') || candidate.credentialId!,
    }))
}

function hasMissingRequiredBinding(_slot: CredentialSlot, selectedValue?: string) {
  return !selectedValue
}

function selectedDeploymentCredentials(
  slots: CredentialSlot[],
  selections: BindingSelections,
): CredentialSelectionInput[] {
  return slots
    .map((slot): CredentialSelectionInput | undefined => {
      const slotKey = credentialSlotKey(slot)
      const selectedValue = selections[slotKey]
      if (!slotKey || !selectedValue)
        return undefined

      return {
        providerId: slot.providerId,
        category: slot.category,
        credentialId: selectedValue,
      }
    })
    .filter((binding): binding is CredentialSelectionInput => Boolean(binding))
}

function selectedBindingSelections(slots: CredentialSlot[], manualBindings: BindingSelections): BindingSelections {
  const next: BindingSelections = {}
  for (const slot of slots) {
    const slotKey = credentialSlotKey(slot)
    const candidates = bindingCandidateOptions(slot)
    const existing = manualBindings[slotKey]
    if (existing && candidates.some(candidate => candidate.value === existing))
      next[slotKey] = existing
    else if (candidates.length === 1 && candidates[0])
      next[slotKey] = candidates[0].value
  }
  return next
}

function BindingOptionsPanel({
  slots,
  selections,
  isLoading,
  hasError,
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
    <div className="overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle">
      <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <div className="system-xs-medium-uppercase text-text-tertiary">{t('deployDrawer.runtimeCredentials')}</div>
        <span className="system-xs-regular text-text-quaternary">{t('deployDrawer.bindingSelectionHint')}</span>
      </div>
      {slots.length === 0
        ? (
            <div className="border-t border-divider-subtle px-3 py-3 system-sm-regular text-text-quaternary">
              {t('deployDrawer.noBindingRequired')}
            </div>
          )
        : slots.map((slot) => {
            const slotKey = credentialSlotKey(slot)
            const candidates = bindingCandidateOptions(slot)
            const selectedValue = selections[slotKey] ?? ''
            const missing = hasMissingRequiredBinding(slot, selectedValue)
            const slotName = slot.providerId || slotKey
            return (
              <div key={slotKey} className="flex flex-col gap-2 border-t border-divider-subtle px-3 py-3">
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] sm:items-start">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate system-sm-medium text-text-secondary" title={slotName}>
                        {slotName}
                      </span>
                      <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                        {t('deployDrawer.requiredBinding')}
                      </span>
                    </div>
                    <span className="font-mono system-xs-regular break-all text-text-quaternary" title={slotKey}>
                      {slotKey}
                    </span>
                  </div>
                  {candidates.length === 0
                    ? (
                        <div className="rounded-lg border border-divider-subtle bg-background-default px-2 py-1.5 system-sm-regular text-text-quaternary">
                          {t('deployDrawer.noCredentialCandidates')}
                        </div>
                      )
                    : (
                        <DeploymentSelect
                          value={selectedValue}
                          onChange={value => onChange(slotKey, value)}
                          options={candidates}
                          placeholder={t('deployDrawer.selectCredential')}
                        />
                      )}
                </div>
                {missing && (
                  <div className="system-xs-regular text-text-destructive">
                    {t('deployDrawer.missingRequiredBinding')}
                  </div>
                )}
              </div>
            )
          })}
    </div>
  )
}

function DeployFormSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonContainer className="gap-2">
        <SkeletonRectangle className="h-5 w-44 animate-pulse" />
        <SkeletonRectangle className="h-3 w-72 animate-pulse" />
      </SkeletonContainer>

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

      <SkeletonRow className="justify-end">
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
  runtimeRows,
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
  const targetReleaseId = displayedRelease?.id ?? selectedRelease?.id ?? selectedReleaseId
  const targetRelease = displayedRelease ?? selectedRelease ?? (targetReleaseId ? { id: targetReleaseId } : undefined)
  const deploymentRows = runtimeRows.filter(hasRuntimeInstanceDeployment)
  const selectedDeploymentRow = deploymentRows.find(row => environmentId(row.environment) === selectedEnvironmentId)
  const action = releaseDeploymentAction({
    targetRelease,
    currentRelease: selectedDeploymentRow?.currentRelease,
    releaseRows: releases,
    isExistingRelease,
  })
  const bindingOptions = useQuery(consoleQuery.enterprise.releaseService.listReleaseCredentialCandidates.queryOptions({
    input: {
      params: {
        releaseId: targetReleaseId || '',
      },
    },
    enabled: Boolean(appInstanceId && targetReleaseId),
  }))
  const bindingSlots = bindingOptions.data?.slots?.filter(slot => credentialSlotKey(slot)) ?? []
  const [manualBindings, setManualBindings] = useState<BindingSelections>({})
  const selectedBindings = selectedBindingSelections(bindingSlots, manualBindings)
  const deploymentCredentials = selectedDeploymentCredentials(bindingSlots, selectedBindings)
  const bindingOptionsLoading = Boolean(targetReleaseId && (bindingOptions.isLoading || bindingOptions.isFetching))
  const bindingOptionsReady = Boolean(targetReleaseId && bindingOptions.data && !bindingOptionsLoading && !bindingOptions.isError)
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredBinding(slot, selectedBindings[credentialSlotKey(slot)]))
  const isSubmitting = startDeploy.isPending
  const canDeploy = Boolean(
    selectedEnvironmentId
    && selectedEnvironment
    && targetReleaseId
    && bindingOptionsReady
    && requiredBindingsReady
    && !isSubmitting,
  )

  const lockedEnv = lockedEnvId ? environments.find(e => e.id === lockedEnvId) : undefined
  const actionTitle = action === 'rollback'
    ? t('deployDrawer.rollbackTitle')
    : action === 'promote'
      ? t('deployDrawer.promoteTitle')
      : action === 'deployExistingRelease'
        ? t('deployDrawer.deployExistingReleaseTitle')
        : t('deployDrawer.title')
  const actionDescription = action === 'rollback'
    ? t('deployDrawer.rollbackDescription')
    : action === 'promote'
      ? t('deployDrawer.promoteDescription')
      : action === 'deployExistingRelease'
        ? t('deployDrawer.deployExistingReleaseDescription')
        : t('deployDrawer.description')
  const submitLabel = isSubmitting
    ? t('deployDrawer.deploying')
    : action === 'rollback'
      ? t('deployDrawer.rollback')
      : action === 'promote'
        ? t('deployDrawer.promote')
        : action === 'deployExistingRelease'
          ? t('deployDrawer.deployExistingRelease')
          : t('deployDrawer.deploy')

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
    <div className="flex flex-col gap-5">
      <div>
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {actionTitle}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {actionDescription}
        </DialogDescription>
      </div>

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
                  <span className="shrink-0 system-xs-regular text-text-quaternary">{displayedRelease.createdAt}</span>
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
                    label: `${environmentName(env)} · ${t(environmentMode(env) === 'isolated' ? 'mode.isolated' : 'mode.shared')} · ${environmentBackend(env).toUpperCase()}`,
                  }))}
                  placeholder={t('deployDrawer.selectEnv')}
                />
              )}
      </Field>

      {targetReleaseId && (
        <BindingOptionsPanel
          slots={bindingSlots}
          selections={selectedBindings}
          isLoading={bindingOptionsLoading}
          hasError={bindingOptions.isError}
          onChange={(slot, value) => setManualBindings(prev => ({ ...prev, [slot]: value }))}
        />
      )}

      <div className="flex justify-end gap-2">
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
      runtimeRows={runtimeRows}
    />
  )
}
