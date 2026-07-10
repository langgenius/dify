'use client'

import type { GuideMethod, WorkflowSourceApp } from '@/features/deployments/create-guide/state/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  dslFileAtom,
  effectiveMethodAtom,
  sourceSearchTextAtom,
} from '@/features/deployments/create-guide/state/primitives'
import { unsupportedDslNodesAtom } from '@/features/deployments/create-guide/state/queries'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  effectiveSelectedAppAtom,
  isReadingDslAtom,
  sourceAppsAtom,
  sourceAppsErrorAtom,
  sourceAppsFetchNextPageAtom,
  sourceAppsHasNextPageAtom,
  sourceAppsIsFetchingAtom,
  sourceAppsIsFetchingNextPageAtom,
  sourceAppsIsLoadingAtom,
  sourceAppsIsPlaceholderDataAtom,
} from '@/features/deployments/create-guide/state/source'
import {
  continueFromSourceAtom,
  selectDslFileAtom,
  selectMethodAtom,
  selectSourceAppAtom,
  setSourceSearchTextAtom,
  sourceCanGoNextAtom,
} from '@/features/deployments/create-guide/state/workflow'
import { DeploymentStateMessage } from '@/features/deployments/shared/components/empty-state'
import { TitleTooltip } from '@/features/deployments/shared/components/title-tooltip'
import { UnsupportedDslNodesAlert } from '@/features/deployments/shared/components/unsupported-dsl-nodes-alert'
import { isDeploymentDslImportEnabled } from '@/features/deployments/shared/domain/feature-flags'
import { useInfiniteScroll } from '@/features/deployments/shared/hooks/use-infinite-scroll'
import { StepShell } from './layout'

const sourceAppSkeletonKeys = ['first-source-app', 'second-source-app', 'third-source-app']

export function SourceStepContent() {
  const method = useAtomValue(effectiveMethodAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SourceMethodSection />
      {method === 'bindApp' && (
        <SourceAppSelectionSection />
      )}
      {method === 'importDsl' && (
        <DslUploadSection />
      )}
      <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
    </div>
  )
}

function SourceMethodSection() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(effectiveMethodAtom)
  const selectMethod = useSetAtom(selectMethodAtom)

  return (
    <StepShell
      title={t($ => $['createGuide.steps.method'])}
      description={t($ => $['createGuide.method.description'])}
      descriptionClassName="lg:hidden"
      hideHeader
    >
      <RadioGroup<GuideMethod>
        value={method}
        onValueChange={selectMethod}
        className="flex flex-col items-stretch gap-2 sm:flex-row"
      >
        <SourceMethodCard
          value="bindApp"
          icon="i-ri-stack-line"
          title={t($ => $['createGuide.methods.bindApp.title'])}
          description={t($ => $['createGuide.methods.bindApp.description'])}
        />
        {isDeploymentDslImportEnabled && (
          <SourceMethodCard
            value="importDsl"
            icon="i-ri-file-code-line"
            title={t($ => $['createGuide.methods.importDsl.title'])}
            description={t($ => $['createGuide.methods.importDsl.description'])}
          />
        )}
      </RadioGroup>
    </StepShell>
  )
}

function SourceMethodCard({ value, icon, title, description, badge }: {
  value: GuideMethod
  icon: string
  title: string
  description: string
  badge?: string
}) {
  return (
    <RadioItem<GuideMethod>
      value={value}
      nativeButton
      render={<button type="button" />}
      className={cn(
        `relative box-content h-[84px] w-full cursor-pointer rounded-xl border-[0.5px]
        border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-3
        text-left shadow-xs outline-hidden hover:shadow-md focus-visible:ring-2
        focus-visible:ring-state-accent-solid sm:w-[240px]`,
        'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:shadow-md data-checked:inset-ring-[0.5px] data-checked:inset-ring-components-option-card-option-selected-border',
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
        <TitleTooltip content={description}>
          <span className="line-clamp-2 min-w-0 grow system-xs-regular text-text-tertiary">
            {description}
          </span>
        </TitleTooltip>
      </span>
    </RadioItem>
  )
}

function SourceAppSelectionSection() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t($ => $['createGuide.source.title'])}
      description={t($ => $['createGuide.source.description'])}
      descriptionClassName="lg:hidden"
      hideHeader
      className="min-h-0 flex-1"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <SourceSearchInput />
        <SourceAppList />
      </div>
    </StepShell>
  )
}

function SourceSearchInput() {
  const { t } = useTranslation('deployments')
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const setSourceSearchText = useSetAtom(setSourceSearchTextAtom)

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
      <Input
        id="create-guide-source-search"
        aria-label={t($ => $['createGuide.source.sourceApp'])}
        value={sourceSearchText}
        onChange={event => setSourceSearchText(event.target.value)}
        placeholder={t($ => $['createGuide.source.searchPlaceholder'])}
        className="h-9 pr-8 pl-8"
      />
      {sourceSearchText && (
        <button
          type="button"
          aria-label={t($ => $['createGuide.source.clearSearch'])}
          onClick={() => setSourceSearchText('')}
          className="absolute top-1/2 right-2.5 flex size-4 -translate-y-1/2 items-center justify-center text-text-quaternary hover:text-text-secondary"
        >
          <span className="i-ri-close-circle-fill size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function SourceAppList() {
  const { t } = useTranslation('deployments')
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const effectiveSelectedApp = useAtomValue(effectiveSelectedAppAtom)
  const sourceApps = useAtomValue(sourceAppsAtom)
  const sourceAppsError = useAtomValue(sourceAppsErrorAtom)
  const sourceAppsFetchNextPage = useAtomValue(sourceAppsFetchNextPageAtom)
  const sourceAppsHasNextPage = useAtomValue(sourceAppsHasNextPageAtom)
  const sourceAppsIsFetching = useAtomValue(sourceAppsIsFetchingAtom)
  const sourceAppsIsFetchingNextPage = useAtomValue(sourceAppsIsFetchingNextPageAtom)
  const sourceAppsIsLoading = useAtomValue(sourceAppsIsLoadingAtom)
  const sourceAppsIsPlaceholderData = useAtomValue(sourceAppsIsPlaceholderDataAtom)
  const sourceAppsLoading = sourceAppsIsLoading || sourceAppsIsPlaceholderData || (sourceAppsIsFetching && sourceApps.length === 0)
  const { rootRef, sentinelRef } = useInfiniteScroll<HTMLDivElement>({
    error: sourceAppsError,
    fetchNextPage: sourceAppsFetchNextPage,
    hasNextPage: sourceAppsHasNextPage,
    isFetching: sourceAppsIsFetching,
    isFetchingNextPage: sourceAppsIsFetchingNextPage,
    isLoading: sourceAppsIsLoading,
  }, {
    enabled: !sourceAppsLoading,
    rootMargin: '0px 0px 160px 0px',
    threshold: 0.1,
  })

  return (
    <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-divider-subtle bg-background-default">
      {sourceAppsLoading
        ? <SourceAppSkeleton />
        : sourceApps.length === 0
          ? (
              <DeploymentStateMessage variant="embedded">
                {t($ => $['createGuide.source.empty'])}
              </DeploymentStateMessage>
            )
          : (
              <div>
                {sourceApps.map(app => (
                  <SourceAppOption
                    key={app.id}
                    app={app}
                    selected={effectiveSelectedApp?.id === app.id}
                    onSelect={() => selectSourceApp(app)}
                  />
                ))}
                {sourceAppsIsFetchingNextPage && (
                  <div className="border-t border-divider-subtle px-3 py-2 text-center system-xs-regular text-text-tertiary">
                    {t($ => $['createModal.loadingApps'])}
                  </div>
                )}
                {sourceAppsHasNextPage && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
              </div>
            )}
    </div>
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

function SourceAppOption({ app, onSelect, selected }: {
  app: WorkflowSourceApp
  onSelect: () => void
  selected: boolean
}) {
  return (
    <label
      className={cn(
        'group flex min-h-14 cursor-pointer items-center gap-3 border-b border-b-divider-subtle px-3 py-2 transition-colors first:rounded-t-lg last:rounded-b-lg last:border-b-0',
        selected
          ? 'bg-state-accent-hover hover:bg-state-accent-hover'
          : 'bg-background-default hover:bg-state-base-hover',
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
      <span className="flex min-w-0 grow">
        <span className={cn('truncate system-sm-medium', selected ? 'text-text-accent' : 'text-text-primary')}>{app.name}</span>
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

function DslUploadSection() {
  const { t } = useTranslation('deployments')
  const dslFile = useAtomValue(dslFileAtom)
  const selectDslFile = useSetAtom(selectDslFileAtom)

  return (
    <StepShell title={t($ => $['createGuide.dsl.title'])} description={t($ => $['createGuide.dsl.description'])} hideHeader>
      <div className="flex flex-col gap-4 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 i-ri-upload-cloud-2-line size-5 shrink-0 text-text-tertiary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="system-sm-semibold text-text-primary">{t($ => $['createGuide.dsl.dropTitle'])}</div>
            <div className="system-sm-regular text-text-tertiary">{t($ => $['createGuide.dsl.dropDescription'])}</div>
          </div>
        </div>
        <Uploader
          className="mt-0"
          file={dslFile}
          updateFile={selectDslFile}
        />
        <DslReadStatus />
      </div>
    </StepShell>
  )
}

function DslReadStatus() {
  const { t } = useTranslation('deployments')
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)

  return (
    <>
      {isReadingDsl && (
        <div className="system-xs-regular text-text-tertiary">
          {t($ => $['createGuide.dsl.reading'])}
        </div>
      )}
      {dslReadError && (
        <div className="system-xs-regular text-text-destructive">
          {t($ => $['createGuide.dsl.readFailed'])}
        </div>
      )}
      {dslUnsupportedMode && (
        <div role="alert" className="system-xs-regular text-text-destructive">
          {t($ => $['createGuide.dsl.unsupportedMode'])}
        </div>
      )}
    </>
  )
}

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(sourceCanGoNextAtom)
  const continueFromSource = useSetAtom(continueFromSourceAtom)

  return (
    <Button
      type="button"
      variant="primary"
      disabled={!canGoNext}
      onClick={() => continueFromSource({
        defaultDslAppName: t($ => $['createGuide.dsl.defaultAppName']),
        defaultReleaseName: t($ => $['createGuide.release.defaultName']),
      })}
    >
      {t($ => $['createGuide.actions.next'])}
    </Button>
  )
}
