'use client'

import type { AppDeployEnvironment, DeploymentBindingSlot, DeploymentRuntimeBinding, EnvironmentDeployment, ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Input from '@/app/components/base/input'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { toAppMode } from '../app-mode'
import { SOURCE_APPS_PAGE_SIZE } from '../data'
import { environmentMode, environmentName } from '../environment'

type GuideMethod = 'bindApp' | 'importDsl'
type GuideStep = 'method' | 'source' | 'release' | 'target' | 'review' | 'done'
type EnvironmentOption = AppDeployEnvironment & { id: string }
type BindingSelections = Record<string, string>

type BindingSelectOption = {
  value: string
  label: string
}

const guideSteps: GuideStep[] = ['method', 'source', 'release', 'target', 'review']
const sourceAppSkeletonKeys = ['first-source-app', 'second-source-app', 'third-source-app']

const plannedEnvironments: EnvironmentOption[] = [
  {
    id: 'env-prod',
    name: 'Production',
    type: 'isolated',
    backend: 'Kubernetes',
    status: 'Ready',
  },
  {
    id: 'env-staging',
    name: 'Staging',
    type: 'shared',
    backend: 'Runner',
    status: 'Ready',
  },
]

const plannedBindingSlots: DeploymentBindingSlot[] = [
  {
    slot: 'openai-model',
    kind: 'model',
    name: 'OpenAI model credential',
    required: true,
    credentialCandidates: [
      {
        credentialId: 'openai-prod',
        displayName: 'OpenAI production key',
      },
    ],
  },
]

function hasEnvironmentId(environment?: AppDeployEnvironment): environment is EnvironmentOption {
  return Boolean(environment?.id)
}

function environmentsFromDeployments(rows?: EnvironmentDeployment[]) {
  return rows?.map(row => row.environment).filter(hasEnvironmentId) ?? []
}

function isEnvBindingSlot(slot: DeploymentBindingSlot) {
  return (slot.kind?.toLowerCase() ?? '').includes('env')
}

function bindingSlotKey(slot: DeploymentBindingSlot) {
  return slot.slot ?? ''
}

function bindingCandidateOptions(slot: DeploymentBindingSlot): BindingSelectOption[] {
  if (isEnvBindingSlot(slot)) {
    return (slot.envVarCandidates ?? [])
      .filter(candidate => candidate.envVarId)
      .map(candidate => ({
        value: candidate.envVarId!,
        label: [
          candidate.name,
          candidate.displayValue,
        ].filter(Boolean).join(' · ') || candidate.envVarId!,
      }))
  }

  return (slot.credentialCandidates ?? [])
    .filter(candidate => candidate.credentialId)
    .map(candidate => ({
      value: candidate.credentialId!,
      label: [
        candidate.displayName,
        candidate.pluginName || candidate.pluginId,
        candidate.pluginVersion,
      ].filter(Boolean).join(' · ') || candidate.credentialId!,
    }))
}

function hasMissingRequiredBinding(slot: DeploymentBindingSlot, selectedValue?: string) {
  return Boolean(slot.required && !selectedValue)
}

function selectedBindingSelections(slots: DeploymentBindingSlot[], manualBindings: BindingSelections): BindingSelections {
  const next: BindingSelections = {}
  for (const slot of slots) {
    const slotKey = bindingSlotKey(slot)
    const candidates = bindingCandidateOptions(slot)
    const existing = manualBindings[slotKey]
    if (existing && candidates.some(candidate => candidate.value === existing))
      next[slotKey] = existing
    else if (candidates.length === 1 && candidates[0])
      next[slotKey] = candidates[0].value
  }
  return next
}

function selectedDeploymentBindings(slots: DeploymentBindingSlot[], selections: BindingSelections): DeploymentRuntimeBinding[] {
  return slots
    .map((slot): DeploymentRuntimeBinding | undefined => {
      const slotKey = bindingSlotKey(slot)
      const selectedValue = selections[slotKey]
      if (!slotKey || !selectedValue)
        return undefined

      return isEnvBindingSlot(slot)
        ? { slot: slotKey, envVarId: selectedValue }
        : { slot: slotKey, credentialId: selectedValue }
    })
    .filter((binding): binding is DeploymentRuntimeBinding => Boolean(binding))
}

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id} ${app.mode}`.toLowerCase()
}

function StepShell({ title, description, children }: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="title-2xl-semi-bold text-text-primary">{title}</h2>
        <p className="system-sm-regular text-text-tertiary">{description}</p>
      </div>
      {children}
    </section>
  )
}

function StepList({ activeStep }: {
  activeStep: GuideStep
}) {
  const { t } = useTranslation('deployments')
  const activeIndex = guideSteps.indexOf(activeStep)

  return (
    <ol className="flex flex-col gap-2">
      {guideSteps.map((step, index) => {
        const isActive = step === activeStep
        const isDone = activeIndex > index || activeStep === 'done'
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border system-2xs-medium',
                isActive
                  ? 'border-primary-600 bg-primary-600 text-text-primary-on-surface'
                  : isDone
                    ? 'border-util-colors-green-green-600 bg-util-colors-green-green-600 text-text-primary-on-surface'
                    : 'border-divider-regular bg-background-default text-text-tertiary',
              )}
            >
              {isDone ? <span className="i-ri-check-line size-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span className={cn('system-sm-medium', isActive ? 'text-text-primary' : 'text-text-tertiary')}>
              {t(`createGuide.steps.${step}`)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function MethodCard({ icon, title, description, badge, selected, onClick }: {
  icon: string
  title: string
  description: string
  badge?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-30 min-w-0 flex-col gap-3 rounded-xl border p-4 text-left transition-colors',
        selected
          ? 'border-primary-600 bg-primary-50 shadow-xs'
          : 'border-components-card-border bg-components-card-bg hover:border-divider-regular hover:bg-background-default-hover',
      )}
    >
      <span className={cn('size-5 text-text-tertiary', icon)} aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate system-md-semibold text-text-primary">{title}</span>
        {badge && (
          <span className="rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {badge}
          </span>
        )}
      </span>
      <span className="system-sm-regular text-text-tertiary">{description}</span>
    </button>
  )
}

function MethodStep({ method, onSelect }: {
  method?: GuideMethod
  onSelect: (method: GuideMethod) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.steps.method')} description={t('createGuide.method.description')}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MethodCard
          icon="i-ri-stack-line"
          title={t('createGuide.methods.bindApp.title')}
          description={t('createGuide.methods.bindApp.description')}
          selected={method === 'bindApp'}
          onClick={() => onSelect('bindApp')}
        />
        <MethodCard
          icon="i-ri-file-code-line"
          title={t('createGuide.methods.importDsl.title')}
          description={t('createGuide.methods.importDsl.description')}
          badge={t('createGuide.methods.mocked')}
          selected={method === 'importDsl'}
          onClick={() => onSelect('importDsl')}
        />
      </div>
    </StepShell>
  )
}

function SourceAppSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {sourceAppSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-18 rounded-xl border border-components-card-border p-3">
          <SkeletonRectangle className="my-0 size-10 animate-pulse rounded-lg" />
          <div className="flex grow flex-col gap-1.5">
            <SkeletonRectangle className="my-0 h-3.5 w-2/3 animate-pulse" />
            <SkeletonRectangle className="my-0 h-2.5 w-1/3 animate-pulse" />
          </div>
        </SkeletonRow>
      ))}
    </div>
  )
}

function SourceAppOption({ app, selected, onSelect }: {
  app: App
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('deployments')
  const mode = toAppMode(app.mode)

  return (
    <label
      className={cn(
        'flex min-h-18 cursor-pointer items-center gap-3 rounded-xl border p-3',
        selected
          ? 'border-primary-600 bg-primary-50'
          : 'border-components-card-border bg-components-card-bg hover:bg-background-default-hover',
      )}
    >
      <AppIcon
        className="shrink-0"
        size="xs"
        iconType={app.icon_type}
        icon={app.icon}
        background={app.icon_background}
        imageUrl={app.icon_url}
      />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="truncate system-sm-semibold text-text-primary">{app.name}</span>
        <span className="system-xs-regular text-text-tertiary">{t(`appMode.${mode}`)}</span>
      </span>
      <input
        type="radio"
        name="source-app"
        checked={selected}
        onChange={onSelect}
        className="size-4 shrink-0 accent-primary-600"
      />
    </label>
  )
}

function SourceStep({
  apps,
  selectedApp,
  searchText,
  isLoading,
  onSearchTextChange,
  onSelectApp,
}: {
  apps: App[]
  selectedApp?: App
  searchText: string
  isLoading: boolean
  onSearchTextChange: (value: string) => void
  onSelectApp: (app: App) => void
}) {
  const { t } = useTranslation('deployments')
  const effectiveSelectedAppId = selectedApp?.id ?? apps[0]?.id
  const filteredApps = searchText.trim()
    ? apps.filter(app => sourceAppSearchText(app).includes(searchText.trim().toLowerCase()))
    : apps

  return (
    <StepShell title={t('createGuide.source.title')} description={t('createGuide.source.description')}>
      <div className="flex flex-col gap-3">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-source-search">
          {t('createGuide.source.sourceApp')}
        </label>
        <Input
          id="create-guide-source-search"
          value={searchText}
          onChange={event => onSearchTextChange(event.target.value)}
          placeholder={t('createGuide.source.searchPlaceholder')}
          showLeftIcon
          showClearIcon
          onClear={() => onSearchTextChange('')}
          className="h-8"
        />
        {isLoading
          ? <SourceAppSkeleton />
          : filteredApps.length === 0
            ? (
                <div className="rounded-xl border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-10 text-center system-sm-regular text-text-tertiary">
                  {t('createGuide.source.empty')}
                </div>
              )
            : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {filteredApps.map(app => (
                    <SourceAppOption
                      key={app.id}
                      app={app}
                      selected={effectiveSelectedAppId === app.id}
                      onSelect={() => onSelectApp(app)}
                    />
                  ))}
                </div>
              )}
      </div>
    </StepShell>
  )
}

function DslStep() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.dsl.title')} description={t('createGuide.dsl.description')}>
      <div className="flex flex-col gap-4 rounded-xl border border-dashed border-components-panel-border bg-components-panel-bg-blur p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 i-ri-upload-cloud-2-line size-5 shrink-0 text-text-tertiary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="system-sm-semibold text-text-primary">{t('createGuide.dsl.dropTitle')}</div>
            <div className="system-sm-regular text-text-tertiary">{t('createGuide.dsl.dropDescription')}</div>
          </div>
        </div>
        <div className="rounded-lg bg-background-default px-3 py-2 font-mono system-xs-regular text-text-tertiary">
          app.workflow.yaml
        </div>
      </div>
    </StepShell>
  )
}

function ReleaseStep({
  instanceName,
  releaseName,
  releaseDescription,
  onInstanceNameChange,
  onReleaseNameChange,
  onReleaseDescriptionChange,
}: {
  instanceName: string
  releaseName: string
  releaseDescription: string
  onInstanceNameChange: (value: string) => void
  onReleaseNameChange: (value: string) => void
  onReleaseDescriptionChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.release.title')} description={t('createGuide.release.description')}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-name">
            {t('createGuide.release.instanceName')}
          </label>
          <Input
            id="create-guide-instance-name"
            value={instanceName}
            onChange={event => onInstanceNameChange(event.target.value)}
            required
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-name">
            {t('createGuide.release.releaseName')}
          </label>
          <Input
            id="create-guide-release-name"
            value={releaseName}
            onChange={event => onReleaseNameChange(event.target.value)}
            required
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-2 lg:col-span-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-note">
            {t('createGuide.release.releaseNote')}
          </label>
          <textarea
            id="create-guide-release-note"
            value={releaseDescription}
            onChange={event => onReleaseDescriptionChange(event.target.value)}
            className="min-h-24 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
          />
        </div>
      </div>
    </StepShell>
  )
}

function EnvironmentOptionRow({ environment, selected, onSelect }: {
  environment: EnvironmentOption
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('deployments')
  const mode = environmentMode(environment)

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border p-3',
        selected
          ? 'border-primary-600 bg-primary-50'
          : 'border-components-card-border bg-components-card-bg hover:bg-background-default-hover',
      )}
    >
      <input
        type="radio"
        name="target-environment"
        checked={selected}
        onChange={onSelect}
        className="size-4 shrink-0 accent-primary-600"
      />
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="truncate system-sm-semibold text-text-primary">{environmentName(environment)}</span>
        <span className="flex flex-wrap items-center gap-1.5 system-xs-regular text-text-tertiary">
          <span>{t(mode === 'isolated' ? 'mode.isolated' : 'mode.shared')}</span>
          <span>{environment.status}</span>
          <span>{environment.backend}</span>
        </span>
      </span>
    </label>
  )
}

function BindingSlotRow({ slot, selectedValue, onChange }: {
  slot: DeploymentBindingSlot
  selectedValue: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const slotKey = bindingSlotKey(slot)
  const candidates = bindingCandidateOptions(slot)
  const missing = hasMissingRequiredBinding(slot, selectedValue)

  return (
    <div className="flex flex-col gap-2 border-t border-divider-subtle px-3 py-3">
      <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate system-sm-medium text-text-secondary" title={slot.name || slotKey}>
              {slot.name || slotKey}
            </span>
            {slot.required && (
              <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                {t('createGuide.target.required')}
              </span>
            )}
          </div>
          <span className="font-mono system-xs-regular break-all text-text-quaternary" title={slotKey}>
            {slotKey}
          </span>
        </div>
        {candidates.length === 0
          ? (
              <div className="rounded-lg border border-divider-subtle bg-background-default px-2 py-1.5 system-sm-regular text-text-quaternary">
                {t('createGuide.target.noCredentialCandidates')}
              </div>
            )
          : (
              <select
                aria-label={slot.name || slotKey}
                value={selectedValue}
                onChange={event => onChange(event.target.value)}
                className="h-8 w-full rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2 system-sm-regular text-components-input-text-filled outline-hidden hover:bg-components-input-bg-hover focus:border-components-input-border-active"
              >
                <option value="">{t('createGuide.target.selectCredential')}</option>
                {candidates.map(candidate => (
                  <option key={candidate.value} value={candidate.value}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            )}
      </div>
      {missing && (
        <div className="system-xs-regular text-text-destructive">
          {t('createGuide.target.missingRequiredBinding')}
        </div>
      )}
    </div>
  )
}

function TargetStep({
  environments,
  bindingSlots,
  selectedEnvironmentId,
  bindingSelections,
  onSelectEnvironment,
  onSelectBinding,
}: {
  environments: EnvironmentOption[]
  bindingSlots: DeploymentBindingSlot[]
  selectedEnvironmentId: string
  bindingSelections: BindingSelections
  onSelectEnvironment: (environmentId: string) => void
  onSelectBinding: (slot: string, value: string) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.target.title')} description={t('createGuide.target.description')}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.environment')}</div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {environments.map(environment => (
              <EnvironmentOptionRow
                key={environment.id}
                environment={environment}
                selected={selectedEnvironmentId === environment.id}
                onSelect={() => onSelectEnvironment(environment.id)}
              />
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle">
          <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
            <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.bindings')}</div>
            <span className="system-xs-regular text-text-quaternary">{t('createGuide.target.bindingHint')}</span>
          </div>
          {bindingSlots.length === 0
            ? (
                <div className="border-t border-divider-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                  {t('createGuide.target.noBindingRequired')}
                </div>
              )
            : bindingSlots.map(slot => (
                <BindingSlotRow
                  key={bindingSlotKey(slot)}
                  slot={slot}
                  selectedValue={bindingSelections[bindingSlotKey(slot)] ?? ''}
                  onChange={value => onSelectBinding(bindingSlotKey(slot), value)}
                />
              ))}
        </div>
      </div>
    </StepShell>
  )
}

function ReviewStep({
  sourceName,
  instanceName,
  releaseName,
  releaseDescription,
  environment,
  bindingSlots,
  bindingSelections,
}: {
  sourceName: string
  instanceName: string
  releaseName: string
  releaseDescription: string
  environment?: EnvironmentOption
  bindingSlots: DeploymentBindingSlot[]
  bindingSelections: BindingSelections
}) {
  const { t } = useTranslation('deployments')
  const environmentDisplayName = environmentName(environment)
  const summaryRows = [
    [t('createGuide.review.source'), sourceName],
    [t('createGuide.review.instance'), instanceName],
    [t('createGuide.review.release'), releaseName],
    [t('createGuide.review.environment'), environmentDisplayName],
  ]
  const planRows = [
    t('createGuide.review.plan.createInstance'),
    t('createGuide.review.plan.createRelease', { release: releaseName }),
    t('createGuide.review.plan.resolveBindings'),
    t('createGuide.review.plan.deployTo', { environment: environmentDisplayName }),
  ]

  return (
    <StepShell title={t('createGuide.review.title')} description={t('createGuide.review.description')}>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <section aria-label={t('createGuide.review.summary')} className="rounded-xl border border-components-card-border bg-components-card-bg p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1">
                <div className="system-xs-medium-uppercase text-text-tertiary">{label}</div>
                <div className="truncate system-sm-semibold text-text-primary" title={value}>{value}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-components-card-border bg-components-card-bg p-4">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.planTitle')}</div>
          <ol className="mt-3 flex flex-col gap-2">
            {planRows.map((row, index) => (
              <li key={row} className="flex items-center gap-2 system-sm-regular text-text-secondary">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background-default system-2xs-medium text-text-tertiary">
                  {index + 1}
                </span>
                <span>{row}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border border-components-card-border bg-components-card-bg p-4 xl:col-span-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.bindings')}</div>
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {bindingSlots.length === 0
              ? (
                  <div className="system-sm-regular text-text-tertiary">{t('createGuide.target.noBindingRequired')}</div>
                )
              : bindingSlots.map((slot) => {
                  const selectedValue = bindingSelections[bindingSlotKey(slot)] ?? ''
                  const selectedCandidate = bindingCandidateOptions(slot).find(candidate => candidate.value === selectedValue)
                  return (
                    <div key={bindingSlotKey(slot)} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-background-default px-3 py-2">
                      <span className="truncate system-sm-medium text-text-secondary">{slot.name || bindingSlotKey(slot)}</span>
                      <span className="truncate system-sm-regular text-text-tertiary">{selectedCandidate?.label || '—'}</span>
                    </div>
                  )
                })}
          </div>
        </section>
        <section className="rounded-xl border border-components-card-border bg-components-card-bg p-4 xl:col-span-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.releaseNote')}</div>
          <div className="mt-2 system-sm-regular whitespace-pre-wrap text-text-secondary">{releaseDescription || '—'}</div>
        </section>
      </div>
    </StepShell>
  )
}

function DoneStep({ environmentName }: {
  environmentName: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.done.title')} description={t('createGuide.done.description', { environment: environmentName })}>
      <div className="flex flex-col gap-4 rounded-xl border border-components-card-border bg-components-card-bg p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-util-colors-green-green-600 text-text-primary-on-surface">
            <span className="i-ri-check-line size-5" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="system-md-semibold text-text-primary">{t('createGuide.done.ready')}</div>
            <div className="system-sm-regular text-text-tertiary">{t('createGuide.done.next')}</div>
          </div>
        </div>
        <div className="flex justify-end">
          <Link
            href="/deployments"
            className="inline-flex h-8 items-center rounded-lg bg-primary-600 px-3 system-sm-medium text-text-primary-on-surface hover:bg-primary-700"
          >
            {t('createGuide.done.backToList')}
          </Link>
        </div>
      </div>
    </StepShell>
  )
}

function GuideActions({
  canContinue,
  isDeploying,
  step,
  onBack,
  onPrimaryAction,
}: {
  canContinue: boolean
  isDeploying: boolean
  step: GuideStep
  onBack: () => void
  onPrimaryAction: () => void
}) {
  const { t } = useTranslation('deployments')
  const primaryLabel = step === 'review'
    ? isDeploying ? t('createGuide.actions.deploying') : t('createGuide.actions.createAndDeploy')
    : t('createGuide.actions.continue')

  if (step === 'done')
    return null

  return (
    <div className="flex items-center justify-between gap-3 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
      <Link
        href="/deployments"
        className="inline-flex h-8 items-center rounded-lg px-3 system-sm-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
      >
        {t('createGuide.actions.cancel')}
      </Link>
      <div className="flex items-center gap-2">
        {step !== 'method' && (
          <Button type="button" variant="secondary" onClick={onBack} disabled={isDeploying}>
            {t('createGuide.actions.back')}
          </Button>
        )}
        <Button type="button" variant="primary" disabled={!canContinue || isDeploying} onClick={onPrimaryAction}>
          {primaryLabel}
        </Button>
      </div>
    </div>
  )
}

export function CreateDeploymentGuide() {
  const { t } = useTranslation('deployments')
  const queryClient = useQueryClient()
  const createInstance = useMutation(consoleQuery.enterprise.appInstanceService.createAppInstance.mutationOptions())
  const createRelease = useMutation(consoleQuery.enterprise.appReleaseService.createRelease.mutationOptions())
  const createDeployment = useMutation(consoleQuery.enterprise.appDeploymentService.createDeployment.mutationOptions())

  const [step, setStep] = useState<GuideStep>('method')
  const [method, setMethod] = useState<GuideMethod>()
  const [sourceSearchText, setSourceSearchText] = useState('')
  const [selectedApp, setSelectedApp] = useState<App>()
  const [instanceName, setInstanceName] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const [releaseDescription, setReleaseDescription] = useState('')
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [manualBindingSelections, setManualBindingSelections] = useState<BindingSelections>({})
  const [createdAppInstanceId, setCreatedAppInstanceId] = useState('')
  const [createdRelease, setCreatedRelease] = useState<ReleaseSummary>()
  const [deployedEnvironmentName, setDeployedEnvironmentName] = useState('')

  const sourceAppsQuery = useInfiniteQuery({
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          page: Number(pageParam),
          limit: SOURCE_APPS_PAGE_SIZE,
          name: sourceSearchText,
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })
  const sourceApps = sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []
  const effectiveSelectedApp = selectedApp ?? sourceApps[0]
  const defaultReleaseNote = t('createGuide.release.defaultNote')
  const hasCreatedReleaseArtifacts = Boolean(createdAppInstanceId && createdRelease?.id)

  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.appDeploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: {
        appInstanceId: createdAppInstanceId,
      },
    },
    enabled: method === 'bindApp' && hasCreatedReleaseArtifacts,
  }))
  const deploymentPlanQuery = useQuery(consoleQuery.enterprise.appDeploymentService.getDeploymentPlan.queryOptions({
    input: {
      params: {
        appInstanceId: createdAppInstanceId,
        releaseId: createdRelease?.id ?? '',
      },
    },
    enabled: method === 'bindApp' && hasCreatedReleaseArtifacts,
  }))

  const environments = method === 'bindApp'
    ? hasCreatedReleaseArtifacts
      ? environmentsFromDeployments(environmentDeploymentsQuery.data?.data)
      : plannedEnvironments
    : plannedEnvironments
  const bindingSlots = method === 'bindApp'
    ? hasCreatedReleaseArtifacts
      ? deploymentPlanQuery.data?.plan?.slots?.filter(slot => bindingSlotKey(slot)) ?? []
      : plannedBindingSlots
    : plannedBindingSlots
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => env.id === effectiveSelectedEnvironmentId) ?? environments[0]
  const bindingSelections = selectedBindingSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredBinding(slot, bindingSelections[bindingSlotKey(slot)]))
  const hasTargetData = method === 'importDsl'
    ? true
    : !hasCreatedReleaseArtifacts || Boolean(environmentDeploymentsQuery.data && deploymentPlanQuery.data)
  const isDeploying = createInstance.isPending || createRelease.isPending || createDeployment.isPending

  function resetCreatedArtifacts() {
    setCreatedAppInstanceId('')
    setCreatedRelease(undefined)
    setDeployedEnvironmentName('')
  }

  function selectMethod(nextMethod: GuideMethod) {
    setMethod(nextMethod)
    resetCreatedArtifacts()
    setManualBindingSelections({})
  }

  function ensureReleaseDefaults() {
    const sourceName = method === 'importDsl'
      ? t('createGuide.dsl.defaultAppName')
      : effectiveSelectedApp?.name ?? ''
    if (!instanceName.trim())
      setInstanceName(sourceName)
    if (!releaseName.trim())
      setReleaseName(`${sourceName}-release`)
    if (!releaseDescription.trim())
      setReleaseDescription(defaultReleaseNote)
  }

  function canContinueCurrentStep() {
    if (step === 'method')
      return Boolean(method)
    if (step === 'source')
      return method === 'importDsl' || Boolean(effectiveSelectedApp?.id)
    if (step === 'release')
      return Boolean(instanceName.trim() && releaseName.trim())
    if (step === 'target') {
      return Boolean(
        selectedEnvironment
        && requiredBindingsReady
        && hasTargetData
        && !environmentDeploymentsQuery.isError
        && !deploymentPlanQuery.isError,
      )
    }
    if (step === 'review')
      return Boolean(!isDeploying)
    return false
  }

  function handleBack() {
    if (isDeploying)
      return
    if (step === 'source')
      setStep('method')
    else if (step === 'release')
      setStep('source')
    else if (step === 'target')
      setStep('release')
    else if (step === 'review')
      setStep('target')
  }

  async function handleDeploy() {
    if (method === 'importDsl') {
      setDeployedEnvironmentName(selectedEnvironment ? environmentName(selectedEnvironment) : '')
      setStep('done')
      return
    }

    if (!effectiveSelectedApp?.id || isDeploying)
      return

    try {
      const trimmedInstanceName = instanceName.trim()
      const trimmedReleaseName = releaseName.trim()
      const trimmedReleaseDescription = releaseDescription.trim()
      const createdInstance = await createInstance.mutateAsync({
        body: {
          sourceAppId: effectiveSelectedApp.id,
          name: trimmedInstanceName,
          description: undefined,
        },
      })

      if (!createdInstance.appInstanceId)
        throw new Error('Create app instance did not return an appInstanceId.')

      const createdReleaseResponse = await createRelease.mutateAsync({
        params: {
          appInstanceId: createdInstance.appInstanceId,
        },
        body: {
          appInstanceId: createdInstance.appInstanceId,
          name: trimmedReleaseName,
          description: trimmedReleaseDescription || undefined,
        },
      })
      const release = createdReleaseResponse.release
      if (!release?.id)
        throw new Error('Create release did not return a release id.')

      const environmentDeployments = await queryClient.fetchQuery(consoleQuery.enterprise.appDeploymentService.listEnvironmentDeployments.queryOptions({
        input: {
          params: {
            appInstanceId: createdInstance.appInstanceId,
          },
        },
      }))
      const realEnvironments = environmentsFromDeployments(environmentDeployments.data)
      const selectedPlannedEnvironmentName = selectedEnvironment ? environmentName(selectedEnvironment) : ''
      const targetEnvironment = realEnvironments.find(env => env.id === effectiveSelectedEnvironmentId)
        ?? realEnvironments.find(env => environmentName(env) === selectedPlannedEnvironmentName)
        ?? realEnvironments[0]

      if (!targetEnvironment?.id)
        throw new Error('No deployable environment found.')

      const deploymentPlan = await queryClient.fetchQuery(consoleQuery.enterprise.appDeploymentService.getDeploymentPlan.queryOptions({
        input: {
          params: {
            appInstanceId: createdInstance.appInstanceId,
            releaseId: release.id,
          },
        },
      }))
      const realBindingSlots = deploymentPlan.plan?.slots?.filter(slot => bindingSlotKey(slot)) ?? []
      const realBindingSelections = selectedBindingSelections(realBindingSlots, manualBindingSelections)
      const missingRequiredBinding = realBindingSlots.some(slot => hasMissingRequiredBinding(slot, realBindingSelections[bindingSlotKey(slot)]))
      if (missingRequiredBinding)
        throw new Error('Missing required deployment binding.')

      await createDeployment.mutateAsync({
        params: {
          appInstanceId: createdInstance.appInstanceId,
          environmentId: targetEnvironment.id,
        },
        body: {
          appInstanceId: createdInstance.appInstanceId,
          environmentId: targetEnvironment.id,
          releaseId: release.id,
          bindings: selectedDeploymentBindings(realBindingSlots, realBindingSelections),
        },
      })

      setCreatedAppInstanceId(createdInstance.appInstanceId)
      setCreatedRelease(release)
      setSelectedEnvironmentId(targetEnvironment.id)
      setDeployedEnvironmentName(environmentName(targetEnvironment))
      setStep('done')
    }
    catch {
      toast.error(t('createGuide.errors.deployFailed'))
    }
  }

  function handlePrimaryAction() {
    if (!canContinueCurrentStep())
      return

    if (step === 'method') {
      setStep(method === 'importDsl' ? 'source' : 'source')
      return
    }
    if (step === 'source') {
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
      ensureReleaseDefaults()
      setStep('release')
      return
    }
    if (step === 'release') {
      resetCreatedArtifacts()
      setStep('target')
      return
    }
    if (step === 'target') {
      setStep('review')
      return
    }
    if (step === 'review')
      void handleDeploy()
  }

  const sourceName = method === 'importDsl'
    ? t('createGuide.dsl.defaultAppName')
    : effectiveSelectedApp?.name ?? ''
  const displayedInstanceName = instanceName.trim() || sourceName
  const displayedReleaseName = createdRelease?.name || releaseName.trim()

  return (
    <div className="flex h-full min-h-0 bg-background-body">
      <aside className="hidden w-64 shrink-0 border-r border-divider-subtle bg-background-default-subtle px-6 py-8 lg:flex lg:flex-col lg:gap-8">
        <div className="flex flex-col gap-1">
          <Link href="/deployments" className="inline-flex items-center gap-1 system-sm-medium text-text-tertiary hover:text-text-secondary">
            <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
            {t('createGuide.nav.back')}
          </Link>
          <h1 className="mt-3 title-xl-semi-bold text-text-primary">{t('createGuide.title')}</h1>
          <p className="system-sm-regular text-text-tertiary">{t('createGuide.description')}</p>
        </div>
        <StepList activeStep={step} />
      </aside>

      <main className="flex min-w-0 grow flex-col overflow-hidden">
        <div className="border-b border-divider-subtle px-6 py-4 lg:hidden">
          <Link href="/deployments" className="inline-flex items-center gap-1 system-sm-medium text-text-tertiary hover:text-text-secondary">
            <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
            {t('createGuide.nav.back')}
          </Link>
          <h1 className="mt-2 title-xl-semi-bold text-text-primary">{t('createGuide.title')}</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-5xl">
            {step === 'method' && (
              <MethodStep method={method} onSelect={selectMethod} />
            )}
            {step === 'source' && method === 'bindApp' && (
              <SourceStep
                apps={sourceApps}
                selectedApp={effectiveSelectedApp}
                searchText={sourceSearchText}
                isLoading={sourceAppsQuery.isLoading || (sourceAppsQuery.isFetching && sourceApps.length === 0)}
                onSearchTextChange={setSourceSearchText}
                onSelectApp={(app) => {
                  setSelectedApp(app)
                  resetCreatedArtifacts()
                }}
              />
            )}
            {step === 'source' && method === 'importDsl' && <DslStep />}
            {step === 'release' && (
              <ReleaseStep
                instanceName={instanceName}
                releaseName={releaseName}
                releaseDescription={releaseDescription}
                onInstanceNameChange={(value) => {
                  setInstanceName(value)
                  resetCreatedArtifacts()
                }}
                onReleaseNameChange={(value) => {
                  setReleaseName(value)
                  resetCreatedArtifacts()
                }}
                onReleaseDescriptionChange={(value) => {
                  setReleaseDescription(value)
                  resetCreatedArtifacts()
                }}
              />
            )}
            {step === 'target' && (
              <TargetStep
                environments={environments}
                bindingSlots={bindingSlots}
                selectedEnvironmentId={effectiveSelectedEnvironmentId}
                bindingSelections={bindingSelections}
                onSelectEnvironment={(environmentId) => {
                  setSelectedEnvironmentId(environmentId)
                  resetCreatedArtifacts()
                }}
                onSelectBinding={(slot, value) => {
                  setManualBindingSelections(prev => ({ ...prev, [slot]: value }))
                  resetCreatedArtifacts()
                }}
              />
            )}
            {step === 'review' && (
              <ReviewStep
                sourceName={sourceName}
                instanceName={displayedInstanceName}
                releaseName={displayedReleaseName}
                releaseDescription={releaseDescription}
                environment={selectedEnvironment}
                bindingSlots={bindingSlots}
                bindingSelections={bindingSelections}
              />
            )}
            {step === 'done' && (
              <DoneStep environmentName={deployedEnvironmentName || (selectedEnvironment ? environmentName(selectedEnvironment) : '')} />
            )}
          </div>
        </div>
        <GuideActions
          canContinue={canContinueCurrentStep()}
          isDeploying={isDeploying}
          step={step}
          onBack={handleBack}
          onPrimaryAction={handlePrimaryAction}
        />
      </main>
    </div>
  )
}
