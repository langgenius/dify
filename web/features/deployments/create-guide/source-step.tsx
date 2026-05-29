'use client'

import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { toAppMode } from '../app-mode'
import { DeploymentStateMessage } from '../components/empty-state'
import { StepShell } from './layout'

const sourceAppSkeletonKeys = ['first-source-app', 'second-source-app', 'third-source-app']

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id} ${app.mode}`.toLowerCase()
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

export function SourceStep({
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
        <div className="max-h-[336px] overflow-y-auto rounded-lg border border-divider-subtle bg-background-default">
          {isLoading
            ? <SourceAppSkeleton />
            : filteredApps.length === 0
              ? (
                  <DeploymentStateMessage variant="embedded">
                    {t('createGuide.source.empty')}
                  </DeploymentStateMessage>
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
