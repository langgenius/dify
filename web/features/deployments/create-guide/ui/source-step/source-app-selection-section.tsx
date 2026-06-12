'use client'

import type { WorkflowSourceApp } from '@/features/deployments/create-guide/state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { DeploymentStateMessage } from '@/features/deployments/components/empty-state'
import {
  effectiveSelectedAppAtom,
  selectSourceAppAtom,
  setSourceSearchTextAtom,
  sourceAppsQueryAtom,
  sourceSearchTextAtom,
} from '@/features/deployments/create-guide/state'
import { StepShell } from '../layout'

const sourceAppSkeletonKeys = ['first-source-app', 'second-source-app', 'third-source-app']

export function SourceAppSelectionSection() {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.source.title')}
      description={t('createGuide.source.description')}
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
        aria-label={t('createGuide.source.sourceApp')}
        value={sourceSearchText}
        onChange={event => setSourceSearchText(event.target.value)}
        placeholder={t('createGuide.source.searchPlaceholder')}
        className="h-9 pr-8 pl-8"
      />
      {sourceSearchText && (
        <button
          type="button"
          aria-label={t('createGuide.source.clearSearch')}
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
  const sourceAppsQuery = useAtomValue(sourceAppsQueryAtom)
  const sourceApps = (sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []) as WorkflowSourceApp[]
  const sourceAppsLoading = sourceAppsQuery.isLoading || sourceAppsQuery.isPlaceholderData || (sourceAppsQuery.isFetching && sourceApps.length === 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-divider-subtle bg-background-default">
      {sourceAppsLoading
        ? <SourceAppSkeleton />
        : sourceApps.length === 0
          ? (
              <DeploymentStateMessage variant="embedded">
                {t('createGuide.source.empty')}
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
                {sourceAppsQuery.hasNextPage && (
                  <div className="flex justify-center border-t border-divider-subtle px-3 py-2">
                    <Button
                      type="button"
                      size="small"
                      disabled={sourceAppsQuery.isFetchingNextPage}
                      onClick={() => {
                        void sourceAppsQuery.fetchNextPage()
                      }}
                    >
                      {sourceAppsQuery.isFetchingNextPage ? t('createModal.loadingApps') : t('createModal.loadMoreApps')}
                    </Button>
                  </div>
                )}
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
