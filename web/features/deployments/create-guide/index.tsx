'use client'

import type {
  CredentialSelectionInput,
  CredentialSlot,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { toAppMode } from '../app-mode'
import { SOURCE_APPS_PAGE_SIZE } from '../data'
import { environmentBackend, environmentMode, environmentName } from '../environment'
import { createDeploymentIdempotencyKey } from '../idempotency'

type GuideMethod = 'bindApp' | 'importDsl'
type GuideStep = 'method' | 'source' | 'release' | 'target' | 'done'
type EnvironmentOption = Environment & { id: string }
type BindingSelections = Record<string, string>

type BindingSelectOption = {
  value: string
  label: string
}

const sourceAppSkeletonKeys = ['first-source-app', 'second-source-app', 'third-source-app']
const targetEnvironmentSkeletonKeys = ['first-target-environment', 'second-target-environment']
const targetBindingSkeletonKeys = ['first-target-binding', 'second-target-binding']

function hasEnvironmentId(environment?: Environment): environment is EnvironmentOption {
  return Boolean(environment?.id)
}

function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value)
  const chunkSize = 0x8000
  const chunks: string[] = []

  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))

  return btoa(chunks.join(''))
}

function bindingSlotKey(slot: CredentialSlot) {
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

function selectedBindingSelections(slots: CredentialSlot[], manualBindings: BindingSelections): BindingSelections {
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

function selectedDeploymentCredentials(
  slots: CredentialSlot[],
  selections: BindingSelections,
): CredentialSelectionInput[] {
  return slots
    .map((slot): CredentialSelectionInput | undefined => {
      const slotKey = bindingSlotKey(slot)
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

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id} ${app.mode}`.toLowerCase()
}

function StepShell({ title, description, descriptionClassName, hideHeader, children }: {
  title: string
  description: string
  descriptionClassName?: string
  hideHeader?: boolean
  children: React.ReactNode
}) {
  return (
    <section aria-label={hideHeader ? title : undefined} className="flex min-w-0 flex-col gap-4">
      {!hideHeader && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="system-md-semibold text-text-primary">{title}</h2>
          <p className={cn('system-sm-regular text-text-tertiary', descriptionClassName)}>{description}</p>
        </div>
      )}
      {children}
    </section>
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
        `relative box-content h-[84px] w-full cursor-pointer rounded-xl border-[0.5px]
        border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-3
        text-left shadow-xs hover:shadow-md sm:w-[191px]`,
        selected && 'shadow-md outline-[1.5px] outline-components-option-card-option-selected-border outline-solid',
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-divider-subtle bg-background-default-subtle">
        <span className={cn('size-4 text-text-tertiary', icon)} aria-hidden="true" />
      </span>
      <span className="mt-2 mb-0.5 flex min-w-0 items-center gap-1">
        <span className="truncate system-sm-semibold text-text-secondary">{title}</span>
        {badge && (
          <span className="shrink-0 rounded-md bg-background-default-subtle px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {badge}
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-start gap-1">
        <span className="line-clamp-2 min-w-0 grow system-xs-regular text-text-tertiary" title={description}>
          {description}
        </span>
      </span>
    </button>
  )
}

function GuideCard({ children, actions }: {
  children: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="min-h-0">
        {children}
      </div>
      {actions}
    </div>
  )
}

function GuideFrame({ activeStep, preview, children }: {
  activeStep: GuideStep
  preview: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background-default-subtle">
      <div className="flex min-w-0 flex-1 shrink-0 justify-center overflow-y-auto lg:justify-end">
        <section
          aria-label={t('createGuide.title')}
          className="w-full max-w-[660px] px-6 sm:px-10"
        >
          <div className="h-6 2xl:h-[139px]" />
          <div className="pt-1 pb-5">
            <h1 className="title-2xl-semi-bold text-text-primary">{t('createGuide.title')}</h1>
          </div>
          {children}
        </section>
      </div>
      <DeploymentPreview activeStep={activeStep} preview={preview} />
    </div>
  )
}

function DeploymentPreview({ activeStep, preview }: {
  activeStep: GuideStep
  preview: React.ReactNode
}) {
  const { t } = useTranslation('deployments')
  const stepInfo = activeStep === 'done'
    ? {
        title: t('createGuide.done.title'),
        description: t('createGuide.done.next'),
      }
    : activeStep === 'target'
      ? {
          title: t('createGuide.target.title'),
          description: t('createGuide.target.description'),
        }
      : activeStep === 'release'
        ? {
            title: t('createGuide.release.title'),
            description: t('createGuide.release.description'),
          }
        : activeStep === 'source'
          ? {
              title: t('createGuide.source.title'),
              description: t('createGuide.source.description'),
            }
          : {
              title: t('createGuide.steps.method'),
              description: t('createGuide.method.description'),
            }

  return (
    <aside
      aria-label={t('createGuide.review.summary')}
      className="relative hidden h-full flex-1 shrink justify-start overflow-hidden lg:flex"
    >
      <div className="absolute top-0 right-0 left-0 h-6 border-b border-b-divider-subtle 2xl:h-[139px]" />
      <div className="h-full w-fit max-w-full border-x border-x-divider-subtle">
        <div className="h-6 2xl:h-[139px]" />
        <div className="px-8 pt-5 pb-4">
          <h4 className="system-sm-semibold-uppercase text-text-secondary">{stepInfo.title}</h4>
          <div className="mt-1 min-h-8 max-w-96 system-xs-regular text-text-tertiary">
            <span>{stepInfo.description}</span>
          </div>
        </div>
        <div className="absolute right-0 left-0 border-b border-b-divider-subtle" />
        <div
          className="flex h-[448px] w-[664px] max-w-full items-center justify-center"
          style={{ background: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(16,24,40,0.04) 4px, transparent 3px, transparent 6px)' }}
        >
          <div className="w-full max-w-[392px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs">
            <div className="flex items-start gap-3 border-b border-divider-subtle px-4 py-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-default-subtle">
                <span className="i-ri-rocket-2-line size-4 text-text-tertiary" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="system-md-semibold text-text-secondary">{t('createGuide.review.title')}</div>
                <div className="mt-0.5 line-clamp-2 system-xs-regular text-text-tertiary">{t('createGuide.review.description')}</div>
              </div>
            </div>
            {preview}
          </div>
        </div>
        <div className="absolute right-0 left-0 border-b border-b-divider-subtle" />
      </div>
    </aside>
  )
}

function MethodStep({ method, onSelect }: {
  method?: GuideMethod
  onSelect: (method: GuideMethod) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.steps.method')}
      description={t('createGuide.method.description')}
      descriptionClassName="lg:hidden"
      hideHeader
    >
      <div className="flex flex-col gap-2 sm:flex-row">
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
          selected={method === 'importDsl'}
          onClick={() => onSelect('importDsl')}
        />
      </div>
    </StepShell>
  )
}

function SourceAppSkeleton() {
  return (
    <div className="divide-y divide-divider-subtle">
      {sourceAppSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-14 px-3 py-2">
          <SkeletonRectangle className="my-0 size-7 animate-pulse rounded-lg" />
          <div className="flex min-w-0 grow flex-col gap-1">
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
        'group flex min-h-14 cursor-pointer items-center gap-3 border-b border-l-2 border-b-divider-subtle px-3 py-2 transition-colors first:rounded-t-lg last:rounded-b-lg last:border-b-0',
        selected
          ? 'border-l-state-accent-solid bg-state-accent-hover hover:bg-state-accent-hover'
          : 'border-l-transparent bg-background-default hover:bg-state-base-hover',
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
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className={cn('truncate system-sm-medium', selected ? 'text-text-accent' : 'text-text-primary')}>{app.name}</span>
        <span className={cn('truncate system-xs-regular', selected ? 'text-text-secondary' : 'text-text-tertiary')}>{t(`appMode.${mode}`)}</span>
      </span>
      <input
        type="radio"
        name="source-app"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full',
          selected ? 'bg-primary-600 text-text-primary-on-surface' : 'text-transparent',
        )}
        aria-hidden="true"
      >
        <span className="i-ri-check-line size-4" />
      </span>
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
    <StepShell
      title={t('createGuide.source.title')}
      description={t('createGuide.source.description')}
      descriptionClassName="lg:hidden"
      hideHeader
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
          <Input
            id="create-guide-source-search"
            aria-label={t('createGuide.source.sourceApp')}
            value={searchText}
            onChange={event => onSearchTextChange(event.target.value)}
            placeholder={t('createGuide.source.searchPlaceholder')}
            className="h-9 pr-8 pl-8"
          />
          {searchText && (
            <button
              type="button"
              aria-label={t('createGuide.source.clearSearch')}
              onClick={() => onSearchTextChange('')}
              className="absolute top-1/2 right-2.5 flex size-4 -translate-y-1/2 items-center justify-center text-text-quaternary hover:text-text-secondary"
            >
              <span className="i-ri-close-circle-fill size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-divider-subtle bg-background-default">
          {isLoading
            ? <SourceAppSkeleton />
            : filteredApps.length === 0
              ? (
                  <div className="px-4 py-10 text-center system-sm-regular text-text-tertiary">
                    {t('createGuide.source.empty')}
                  </div>
                )
              : (
                  <div>
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
      </div>
    </StepShell>
  )
}

function DslStep({
  dslFile,
  isReadingDsl,
  readError,
  onDslFileChange,
}: {
  dslFile?: File
  isReadingDsl: boolean
  readError: boolean
  onDslFileChange: (file?: File) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.dsl.title')} description={t('createGuide.dsl.description')} hideHeader>
      <div className="flex flex-col gap-4 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 i-ri-upload-cloud-2-line size-5 shrink-0 text-text-tertiary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="system-sm-semibold text-text-primary">{t('createGuide.dsl.dropTitle')}</div>
            <div className="system-sm-regular text-text-tertiary">{t('createGuide.dsl.dropDescription')}</div>
          </div>
        </div>
        <Uploader
          className="mt-0"
          file={dslFile}
          updateFile={onDslFileChange}
        />
        {isReadingDsl && (
          <div className="system-xs-regular text-text-tertiary">
            {t('createGuide.dsl.reading')}
          </div>
        )}
        {readError && (
          <div className="system-xs-regular text-text-destructive">
            {t('createGuide.dsl.readFailed')}
          </div>
        )}
      </div>
    </StepShell>
  )
}

function ReleaseStep({
  instanceName,
  instanceDescription,
  releaseName,
  releaseDescription,
  instanceNamePlaceholder,
  releaseNamePlaceholder,
  onInstanceNameChange,
  onInstanceDescriptionChange,
  onReleaseNameChange,
  onReleaseDescriptionChange,
}: {
  instanceName: string
  instanceDescription: string
  releaseName: string
  releaseDescription: string
  instanceNamePlaceholder: string
  releaseNamePlaceholder: string
  onInstanceNameChange: (value: string) => void
  onInstanceDescriptionChange: (value: string) => void
  onReleaseNameChange: (value: string) => void
  onReleaseDescriptionChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.release.title')}
      description={t('createGuide.release.description')}
      hideHeader
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-name">
              {t('createGuide.release.instanceName')}
            </label>
            <Input
              id="create-guide-instance-name"
              value={instanceName}
              onChange={event => onInstanceNameChange(event.target.value)}
              placeholder={instanceNamePlaceholder}
              required
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-instance-description">
              {t('createGuide.release.instanceDescription')}
            </label>
            <textarea
              id="create-guide-instance-description"
              value={instanceDescription}
              onChange={event => onInstanceDescriptionChange(event.target.value)}
              className="min-h-20 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-name">
              {t('createGuide.release.releaseName')}
            </label>
            <Input
              id="create-guide-release-name"
              value={releaseName}
              onChange={event => onReleaseNameChange(event.target.value)}
              placeholder={releaseNamePlaceholder}
              required
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="create-guide-release-description">
              {t('createGuide.release.releaseDescription')}
            </label>
            <textarea
              id="create-guide-release-description"
              value={releaseDescription}
              onChange={event => onReleaseDescriptionChange(event.target.value)}
              className="min-h-20 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
            />
          </div>
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
          ? 'border-state-accent-solid bg-state-accent-hover shadow-xs'
          : 'border-components-option-card-option-border bg-components-option-card-option-bg hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
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
        <span className={cn('truncate system-sm-semibold', selected ? 'text-text-accent' : 'text-text-primary')}>{environmentName(environment)}</span>
        <span className={cn('flex flex-wrap items-center gap-1.5 system-xs-regular', selected ? 'text-text-secondary' : 'text-text-tertiary')}>
          <span>{t(mode === 'isolated' ? 'mode.isolated' : 'mode.shared')}</span>
          <span>{environmentBackend(environment)}</span>
        </span>
      </span>
    </label>
  )
}

function BindingSlotRow({ slot, selectedValue, onChange }: {
  slot: CredentialSlot
  selectedValue: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const slotKey = bindingSlotKey(slot)
  const candidates = bindingCandidateOptions(slot)
  const missing = hasMissingRequiredBinding(slot, selectedValue)
  const slotName = slot.providerId || slotKey

  return (
    <div className="flex flex-col gap-2 border-t border-divider-subtle px-3 py-3">
      <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate system-sm-medium text-text-secondary" title={slotName}>
              {slotName}
            </span>
            <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {t('createGuide.target.required')}
            </span>
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
                aria-label={slotName}
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

function TargetEnvironmentSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {targetEnvironmentSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-17 rounded-xl border border-divider-subtle px-3 py-3">
          <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-full" />
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <SkeletonRectangle className="my-0 h-3.5 w-1/2 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-2/3 animate-pulse" />
          </div>
        </SkeletonRow>
      ))}
    </div>
  )
}

function TargetBindingSkeleton() {
  return (
    <div className="border-t border-divider-subtle">
      {targetBindingSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-15 px-3 py-3">
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <SkeletonRectangle className="my-0 h-3.5 w-1/3 animate-pulse" />
            <SkeletonRectangle className="my-0 h-3 w-1/2 animate-pulse" />
          </div>
          <SkeletonRectangle className="my-0 h-8 w-48 animate-pulse rounded-lg" />
        </SkeletonRow>
      ))}
    </div>
  )
}

function TargetStep({
  environments,
  bindingSlots,
  selectedEnvironmentId,
  bindingSelections,
  isEnvironmentLoading,
  isEnvironmentError,
  isBindingLoading,
  isBindingError,
  onSelectEnvironment,
  onSelectBinding,
}: {
  environments: EnvironmentOption[]
  bindingSlots: CredentialSlot[]
  selectedEnvironmentId: string
  bindingSelections: BindingSelections
  isEnvironmentLoading: boolean
  isEnvironmentError: boolean
  isBindingLoading: boolean
  isBindingError: boolean
  onSelectEnvironment: (environmentId: string) => void
  onSelectBinding: (slot: string, value: string) => void
}) {
  const { t } = useTranslation('deployments')
  const hasEnvironmentOptions = environments.length > 0

  return (
    <StepShell
      title={t('createGuide.target.title')}
      description={t('createGuide.target.description')}
      hideHeader
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.environment')}</div>
          {hasEnvironmentOptions
            ? (
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
              )
            : isEnvironmentLoading
              ? <TargetEnvironmentSkeleton />
              : (
                  <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                    {isEnvironmentError
                      ? t('createGuide.target.loadEnvironmentsFailed')
                      : t('createGuide.target.noEnvironmentOptions')}
                  </div>
                )}
        </div>
        <div className="overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg">
          <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
            <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.bindings')}</div>
            <span className="system-xs-regular text-text-quaternary">{t('createGuide.target.bindingHint')}</span>
          </div>
          {isBindingLoading
            ? <TargetBindingSkeleton />
            : isBindingError
              ? (
                  <div className="border-t border-divider-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                    {t('createGuide.target.loadBindingsFailed')}
                  </div>
                )
              : bindingSlots.length === 0
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

function DeploymentSummaryPreview({
  sourceName,
  instanceName,
  releaseName,
  releaseDescription,
  targetEnvironmentName,
  bindingSlots,
  bindingSelections,
}: {
  sourceName: string
  instanceName: string
  releaseName: string
  releaseDescription: string
  targetEnvironmentName: string
  bindingSlots: CredentialSlot[]
  bindingSelections: BindingSelections
}) {
  const { t } = useTranslation('deployments')
  const displayValue = (value: string) => value || '—'
  const sourceDisplayName = displayValue(sourceName)
  const instanceDisplayName = displayValue(instanceName)
  const releaseDisplayName = displayValue(releaseName)
  const environmentDisplayName = displayValue(targetEnvironmentName)
  const routeItems = [
    {
      icon: 'i-ri-apps-2-line',
      label: t('createGuide.review.source'),
      meta: `${t('createGuide.review.instance')} ${instanceDisplayName}`,
      value: sourceDisplayName,
    },
    {
      icon: 'i-ri-price-tag-3-line',
      label: t('createGuide.review.release'),
      value: releaseDisplayName,
    },
    {
      icon: 'i-ri-cloud-line',
      label: t('createGuide.review.environment'),
      value: environmentDisplayName,
    },
  ]

  return (
    <div className="flex max-h-[360px] flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col">
        {routeItems.map((item, index) => (
          <div key={item.label} className="flex min-w-0 gap-3">
            <div className="flex w-8 shrink-0 flex-col items-center">
              <span className="flex size-8 items-center justify-center rounded-lg border border-divider-subtle bg-background-default-subtle">
                <span className={cn('size-4 text-text-tertiary', item.icon)} aria-hidden="true" />
              </span>
              {index < routeItems.length - 1 && <span className="my-1 h-5 w-px bg-divider-subtle" aria-hidden="true" />}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <div className="system-2xs-medium-uppercase text-text-tertiary">{item.label}</div>
              <div className="truncate system-sm-semibold text-text-primary" title={item.value}>{item.value}</div>
              {item.meta && <div className="mt-0.5 truncate system-xs-regular text-text-tertiary" title={item.meta}>{item.meta}</div>}
            </div>
          </div>
        ))}
      </div>
      <div>
        <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.bindings')}</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {bindingSlots.length === 0
            ? (
                <div className="rounded-lg bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
                  {t('createGuide.target.noBindingRequired')}
                </div>
              )
            : bindingSlots.map((slot) => {
                const selectedValue = bindingSelections[bindingSlotKey(slot)] ?? ''
                const selectedCandidate = bindingCandidateOptions(slot).find(candidate => candidate.value === selectedValue)
                return (
                  <div key={bindingSlotKey(slot)} className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2 rounded-lg bg-background-default-subtle px-3 py-2">
                    <span className="truncate system-xs-medium text-text-secondary">{slot.providerId || bindingSlotKey(slot)}</span>
                    <span className="truncate text-right system-xs-regular text-text-tertiary">{selectedCandidate?.label || '—'}</span>
                  </div>
                )
              })}
        </div>
      </div>
      <div>
        <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.releaseNote')}</div>
        <div className="mt-1 line-clamp-3 system-xs-regular whitespace-pre-wrap text-text-secondary">{releaseDescription || '—'}</div>
      </div>
    </div>
  )
}

function DoneStep({ environmentName }: {
  environmentName: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.done.title')} description={t('createGuide.done.description', { environment: environmentName })}>
      <div className="flex flex-col gap-4 rounded-lg bg-background-default-subtle p-4">
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
  const primaryLabel = step === 'target'
    ? isDeploying ? t('createGuide.actions.deploying') : t('createGuide.actions.deploy')
    : step === 'release' && isDeploying
      ? t('createGuide.actions.creating')
      : t('createGuide.actions.next')

  if (step === 'method' || step === 'done')
    return null

  return (
    <div className="flex items-center justify-end gap-2 pt-5 pb-10">
      {(step === 'release' || step === 'target') && (
        <Button type="button" variant="secondary" onClick={onBack} disabled={isDeploying}>
          {t('createGuide.actions.back')}
        </Button>
      )}
      <Button type="button" variant="primary" disabled={!canContinue || isDeploying} onClick={onPrimaryAction}>
        {primaryLabel}
      </Button>
    </div>
  )
}

function CreationSections({
  children,
  defaultedReleaseName,
  instanceDescription,
  instanceName,
  method,
  onInstanceDescriptionChange,
  onInstanceNameChange,
  onReleaseDescriptionChange,
  onReleaseNameChange,
  onSearchTextChange,
  onSelectMethod,
  onSelectSourceApp,
  onDslFileChange,
  releaseDescription,
  releaseName,
  selectedApp,
  sourceApps,
  sourceAppsLoading,
  sourceName,
  sourceSearchText,
  stage,
  dslFile,
  isReadingDsl,
  dslReadError,
}: {
  children?: React.ReactNode
  defaultedReleaseName: string
  instanceDescription: string
  instanceName: string
  method?: GuideMethod
  onInstanceDescriptionChange: (value: string) => void
  onInstanceNameChange: (value: string) => void
  onReleaseDescriptionChange: (value: string) => void
  onReleaseNameChange: (value: string) => void
  onSearchTextChange: (value: string) => void
  onSelectMethod: (method: GuideMethod) => void
  onSelectSourceApp: (app: App) => void
  onDslFileChange: (file?: File) => void
  releaseDescription: string
  releaseName: string
  selectedApp?: App
  sourceApps: App[]
  sourceAppsLoading: boolean
  sourceName: string
  sourceSearchText: string
  stage: 'source' | 'release'
  dslFile?: File
  isReadingDsl: boolean
  dslReadError: boolean
}) {
  return (
    <div className="flex flex-col gap-7 pb-4">
      {stage === 'source' && (
        <>
          <MethodStep method={method} onSelect={onSelectMethod} />
          {method === 'bindApp' && (
            <SourceStep
              apps={sourceApps}
              selectedApp={selectedApp}
              searchText={sourceSearchText}
              isLoading={sourceAppsLoading}
              onSearchTextChange={onSearchTextChange}
              onSelectApp={onSelectSourceApp}
            />
          )}
          {method === 'importDsl' && (
            <DslStep
              dslFile={dslFile}
              isReadingDsl={isReadingDsl}
              readError={dslReadError}
              onDslFileChange={onDslFileChange}
            />
          )}
        </>
      )}
      {stage === 'release' && method && (
        <ReleaseStep
          instanceName={instanceName}
          instanceDescription={instanceDescription}
          releaseName={releaseName}
          releaseDescription={releaseDescription}
          instanceNamePlaceholder={sourceName}
          releaseNamePlaceholder={defaultedReleaseName}
          onInstanceNameChange={onInstanceNameChange}
          onInstanceDescriptionChange={onInstanceDescriptionChange}
          onReleaseNameChange={onReleaseNameChange}
          onReleaseDescriptionChange={onReleaseDescriptionChange}
        />
      )}
      {children}
    </div>
  )
}

function TargetReviewSections({
  bindingSelections,
  bindingSlots,
  environments,
  isBindingError,
  isBindingLoading,
  isEnvironmentError,
  isEnvironmentLoading,
  onSelectBinding,
  onSelectEnvironment,
  selectedEnvironmentId,
}: {
  bindingSelections: BindingSelections
  bindingSlots: CredentialSlot[]
  environments: EnvironmentOption[]
  isBindingError: boolean
  isBindingLoading: boolean
  isEnvironmentError: boolean
  isEnvironmentLoading: boolean
  onSelectBinding: (slot: string, value: string) => void
  onSelectEnvironment: (environmentId: string) => void
  selectedEnvironmentId: string
}) {
  return (
    <TargetStep
      environments={environments}
      bindingSlots={bindingSlots}
      selectedEnvironmentId={selectedEnvironmentId}
      bindingSelections={bindingSelections}
      isEnvironmentLoading={isEnvironmentLoading}
      isEnvironmentError={isEnvironmentError}
      isBindingLoading={isBindingLoading}
      isBindingError={isBindingError}
      onSelectEnvironment={onSelectEnvironment}
      onSelectBinding={onSelectBinding}
    />
  )
}

export function CreateDeploymentGuide() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const createInitialDeploymentFromSourceApp = useMutation(consoleQuery.enterprise.deploymentService.createInitialDeploymentFromSourceApp.mutationOptions())
  const createInitialDeploymentFromDsl = useMutation(consoleQuery.enterprise.deploymentService.createInitialDeploymentFromDsl.mutationOptions())

  const [step, setStep] = useState<GuideStep>('source')
  const [method, setMethod] = useState<GuideMethod>('bindApp')
  const [sourceSearchText, setSourceSearchText] = useState('')
  const [selectedApp, setSelectedApp] = useState<App>()
  const [dslFile, setDslFile] = useState<File>()
  const [dslContent, setDslContent] = useState('')
  const [isReadingDsl, setIsReadingDsl] = useState(false)
  const [dslReadError, setDslReadError] = useState(false)
  const [instanceName, setInstanceName] = useState('')
  const [instanceDescription, setInstanceDescription] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const [releaseDescription, setReleaseDescription] = useState('')
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [manualBindingSelections, setManualBindingSelections] = useState<BindingSelections>({})
  const [deployedEnvironmentName, setDeployedEnvironmentName] = useState('')
  const dslReadTokenRef = useRef(0)

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
  const hasDslContent = Boolean(dslContent.trim())
  const encodedDslContent = hasDslContent ? encodeUtf8Base64(dslContent) : ''
  const shouldLoadSourceDeploymentTarget = method === 'bindApp' && Boolean(effectiveSelectedApp?.id) && step === 'target'
  const shouldLoadDslDeploymentTarget = method === 'importDsl' && hasDslContent && step === 'target'
  const shouldLoadDeploymentTarget = shouldLoadSourceDeploymentTarget || shouldLoadDslDeploymentTarget

  const deployableEnvironmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled: shouldLoadDeploymentTarget,
  }))
  const sourceDeploymentOptionsQuery = useQuery(consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
    input: {
      body: {
        sourceAppId: effectiveSelectedApp?.id ?? '',
      },
    },
    enabled: shouldLoadSourceDeploymentTarget,
  }))
  const dslDeploymentOptionsQuery = useQuery(consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
    input: {
      body: {
        dsl: encodedDslContent,
      },
    },
    enabled: shouldLoadDslDeploymentTarget,
  }))
  const deploymentOptionsQuery = method === 'importDsl' ? dslDeploymentOptionsQuery : sourceDeploymentOptionsQuery
  const deploymentOptions = deploymentOptionsQuery.data?.options

  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data?.filter(hasEnvironmentId) ?? []
    : []
  const bindingSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.credentialSlots?.filter(slot => bindingSlotKey(slot)) ?? []
    : []
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => env.id === effectiveSelectedEnvironmentId) ?? environments[0]
  const selectedTargetEnvironmentName = selectedEnvironment ? environmentName(selectedEnvironment) : ''
  const bindingSelections = selectedBindingSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredBinding(slot, bindingSelections[bindingSlotKey(slot)]))
  const isEnvironmentLoading = shouldLoadDeploymentTarget && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
  const isBindingLoading = shouldLoadDeploymentTarget && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
  const isDeploying = createInitialDeploymentFromSourceApp.isPending || createInitialDeploymentFromDsl.isPending
  const sourceName = method === 'importDsl'
    ? t('createGuide.dsl.defaultAppName')
    : method === 'bindApp'
      ? effectiveSelectedApp?.name ?? ''
      : ''
  const displayedInstanceName = instanceName.trim() || sourceName
  const defaultedReleaseName = t('createGuide.release.defaultName')
  const displayedReleaseName = releaseName.trim() || defaultedReleaseName
  const displayedReleaseDescription = releaseDescription.trim()
  const showTargetConfiguration = Boolean(method && step === 'target')

  function resetCreatedArtifacts() {
    setDeployedEnvironmentName('')
  }

  function selectMethod(nextMethod: GuideMethod) {
    setMethod(nextMethod)
    resetCreatedArtifacts()
    setSelectedEnvironmentId('')
    setManualBindingSelections({})
  }

  function handleDslFileChange(file?: File) {
    const readToken = dslReadTokenRef.current + 1
    dslReadTokenRef.current = readToken
    setDslFile(file)
    setDslContent('')
    setDslReadError(false)
    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    resetCreatedArtifacts()

    if (!file) {
      setIsReadingDsl(false)
      return
    }

    setIsReadingDsl(true)
    void file.text()
      .then((content) => {
        if (dslReadTokenRef.current !== readToken)
          return
        setDslContent(content)
      })
      .catch(() => {
        if (dslReadTokenRef.current !== readToken)
          return
        setDslReadError(true)
      })
      .finally(() => {
        if (dslReadTokenRef.current !== readToken)
          return
        setIsReadingDsl(false)
      })
  }

  function handleSelectMethod(nextMethod: GuideMethod) {
    selectMethod(nextMethod)
    setStep('source')
  }

  function canContinueCurrentStep() {
    if (step === 'method')
      return Boolean(method)
    if (step === 'source')
      return Boolean(method && (method === 'importDsl' ? hasDslContent && !isReadingDsl && !dslReadError : effectiveSelectedApp?.id))
    if (step === 'release') {
      return Boolean(
        method
        && (method === 'importDsl' ? hasDslContent && !isReadingDsl && !dslReadError : effectiveSelectedApp?.id)
        && displayedInstanceName.trim()
        && displayedReleaseName.trim(),
      )
    }
    if (step === 'target') {
      const deploymentTargetReady = shouldLoadDeploymentTarget
        && !isEnvironmentLoading
        && !deployableEnvironmentsQuery.isError
        && !isBindingLoading
        && !deploymentOptionsQuery.isError
      return Boolean(
        selectedEnvironment?.id
        && deploymentTargetReady
        && requiredBindingsReady,
      )
    }
    return false
  }

  function handleBack() {
    if (isDeploying)
      return
    if (step === 'release')
      setStep('source')
    else if (step === 'target')
      setStep('release')
  }

  async function createReleaseArtifactsAndContinue() {
    if (method === 'bindApp' && (!effectiveSelectedApp?.id || isDeploying))
      return
    if (method === 'importDsl' && (!hasDslContent || isReadingDsl || dslReadError || isDeploying))
      return

    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    setDeployedEnvironmentName('')
    setStep('target')
  }

  async function handleDeploy() {
    if (!selectedEnvironment?.id || isDeploying)
      return

    try {
      const missingRequiredBinding = bindingSlots.some(slot => hasMissingRequiredBinding(slot, bindingSelections[bindingSlotKey(slot)]))
      if (missingRequiredBinding)
        throw new Error('Missing required deployment binding.')

      const idempotencyKey = createDeploymentIdempotencyKey()
      const response = method === 'importDsl'
        ? await createInitialDeploymentFromDsl.mutateAsync({
            body: {
              dsl: encodedDslContent,
              environmentId: selectedEnvironment.id,
              appInstanceName: displayedInstanceName.trim(),
              appInstanceDescription: instanceDescription.trim() || undefined,
              releaseName: displayedReleaseName.trim(),
              releaseDescription: displayedReleaseDescription.trim() || undefined,
              credentials: selectedDeploymentCredentials(bindingSlots, bindingSelections),
              idempotencyKey,
              expectedDslDigest: deploymentOptions?.dslDigest,
            },
          })
        : effectiveSelectedApp?.id
          ? await createInitialDeploymentFromSourceApp.mutateAsync({
              body: {
                sourceAppId: effectiveSelectedApp.id,
                environmentId: selectedEnvironment.id,
                appInstanceName: displayedInstanceName.trim(),
                appInstanceDescription: instanceDescription.trim() || undefined,
                releaseName: displayedReleaseName.trim(),
                releaseDescription: displayedReleaseDescription.trim() || undefined,
                credentials: selectedDeploymentCredentials(bindingSlots, bindingSelections),
                idempotencyKey,
                expectedDslDigest: deploymentOptions?.dslDigest,
              },
            })
          : undefined
      const appInstanceId = response?.appInstance?.id ?? response?.release?.appInstanceId
      if (!appInstanceId)
        throw new Error('Create initial deployment did not return an app instance.')

      setSelectedEnvironmentId(selectedEnvironment.id)
      setDeployedEnvironmentName(environmentName(selectedEnvironment))
      router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch {
      toast.error(t('createGuide.errors.deployFailed'))
    }
  }

  function handlePrimaryAction() {
    if (!canContinueCurrentStep())
      return

    if (step === 'method') {
      setStep('source')
      return
    }
    if (step === 'source') {
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
      setStep('release')
      return
    }
    if (step === 'release') {
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
      void createReleaseArtifactsAndContinue()
      return
    }
    if (step === 'target') {
      void handleDeploy()
    }
  }

  const deploymentPreview = (
    <DeploymentSummaryPreview
      sourceName={sourceName}
      instanceName={displayedInstanceName}
      releaseName={displayedReleaseName}
      releaseDescription={displayedReleaseDescription}
      targetEnvironmentName={selectedTargetEnvironmentName}
      bindingSlots={bindingSlots}
      bindingSelections={bindingSelections}
    />
  )

  const guideContent = (
    <>
      {step === 'done'
        ? (
            <DoneStep environmentName={deployedEnvironmentName || selectedTargetEnvironmentName} />
          )
        : showTargetConfiguration
          ? (
              <div className="flex flex-col gap-7 pb-4">
                <TargetReviewSections
                  environments={environments}
                  bindingSlots={bindingSlots}
                  selectedEnvironmentId={effectiveSelectedEnvironmentId}
                  bindingSelections={bindingSelections}
                  isEnvironmentLoading={isEnvironmentLoading}
                  isEnvironmentError={deployableEnvironmentsQuery.isError}
                  isBindingLoading={isBindingLoading}
                  isBindingError={deploymentOptionsQuery.isError}
                  onSelectEnvironment={setSelectedEnvironmentId}
                  onSelectBinding={(slot, value) => {
                    setManualBindingSelections(prev => ({ ...prev, [slot]: value }))
                  }}
                />
              </div>
            )
          : (
              <CreationSections
                stage={step === 'release' ? 'release' : 'source'}
                method={method}
                sourceApps={sourceApps}
                selectedApp={effectiveSelectedApp}
                sourceSearchText={sourceSearchText}
                sourceAppsLoading={sourceAppsQuery.isLoading || (sourceAppsQuery.isFetching && sourceApps.length === 0)}
                sourceName={sourceName}
                instanceName={instanceName}
                instanceDescription={instanceDescription}
                releaseName={releaseName}
                releaseDescription={releaseDescription}
                defaultedReleaseName={defaultedReleaseName}
                onSelectMethod={handleSelectMethod}
                onSearchTextChange={setSourceSearchText}
                dslFile={dslFile}
                isReadingDsl={isReadingDsl}
                dslReadError={dslReadError}
                onDslFileChange={handleDslFileChange}
                onSelectSourceApp={(app) => {
                  setSelectedApp(app)
                  resetCreatedArtifacts()
                }}
                onInstanceNameChange={(value) => {
                  setInstanceName(value)
                  resetCreatedArtifacts()
                  setStep('release')
                }}
                onInstanceDescriptionChange={(value) => {
                  setInstanceDescription(value)
                  resetCreatedArtifacts()
                  setStep('release')
                }}
                onReleaseNameChange={(value) => {
                  setReleaseName(value)
                  resetCreatedArtifacts()
                  setStep('release')
                }}
                onReleaseDescriptionChange={(value) => {
                  setReleaseDescription(value)
                  resetCreatedArtifacts()
                  setStep('release')
                }}
              />
            )}
    </>
  )

  return (
    <div className="fixed inset-0 z-50 bg-background-overlay-backdrop p-4 backdrop-blur-[6px]">
      <div className="h-full w-full overflow-hidden rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <main className="relative flex h-full min-w-0 grow flex-col overflow-hidden">
          <Link
            href="/deployments"
            aria-label={t('createGuide.nav.back')}
            className="absolute top-3 right-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover"
          >
            <span aria-hidden="true" className="i-ri-close-large-line h-3.5 w-3.5 text-components-button-tertiary-text" />
          </Link>
          <GuideFrame activeStep={step} preview={deploymentPreview}>
            <GuideCard
              actions={(
                <GuideActions
                  canContinue={canContinueCurrentStep()}
                  isDeploying={isDeploying}
                  step={step}
                  onBack={handleBack}
                  onPrimaryAction={handlePrimaryAction}
                />
              )}
            >
              {guideContent}
            </GuideCard>
          </GuideFrame>
        </main>
      </div>
    </div>
  )
}
