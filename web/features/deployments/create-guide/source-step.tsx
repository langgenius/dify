'use client'

import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { toAppMode } from '../app-mode'
import { StepShell } from './layout'

const sourceAppSkeletonKeys = ['first-source-app', 'second-source-app', 'third-source-app']

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id} ${app.mode}`.toLowerCase()
}

function SourceAppSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {sourceAppSkeletonKeys.map(key => (
        <SkeletonRow key={key} className="h-[52px] rounded-md border border-transparent px-3 py-2">
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
        'group flex min-h-[52px] cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2 transition-all',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs ring-[0.5px] ring-components-option-card-option-selected-border ring-inset hover:bg-components-option-card-option-selected-bg'
          : 'bg-transparent hover:border-components-option-card-option-border-hover hover:bg-state-base-hover',
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
        <span className="truncate system-sm-medium text-text-primary">{app.name}</span>
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
          selected ? 'bg-state-accent-active text-text-accent' : 'text-transparent',
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
  const shouldScrollSourceApps = filteredApps.length > 6
  const availableAppsLabel = t('createGuide.source.availableApps', { count: filteredApps.length })

  return (
    <StepShell
      title={t('createGuide.source.title')}
      description={t('createGuide.source.description')}
      descriptionClassName="lg:hidden"
      hideHeader
    >
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="system-sm-semibold text-text-primary">
            {t('createGuide.source.sourceApp')}
          </h3>
          {!isLoading && (
            <span className="shrink-0 system-xs-regular text-text-quaternary">
              {availableAppsLabel}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
            <Input
              id="create-guide-source-search"
              aria-label={t('createGuide.source.sourceApp')}
              value={searchText}
              onChange={event => onSearchTextChange(event.target.value)}
              placeholder={t('createGuide.source.searchPlaceholder')}
              className="h-8 bg-background-default pr-8 pl-8 shadow-xs"
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
          <div className="rounded-lg border border-divider-subtle bg-background-default p-1 shadow-xs">
            {isLoading
              ? <SourceAppSkeleton />
              : filteredApps.length === 0
                ? (
                    <div className="px-4 py-10 text-center system-sm-regular text-text-tertiary">
                      {t('createGuide.source.empty')}
                    </div>
                  )
                : (
                    <ScrollArea
                      className={cn('min-h-0', shouldScrollSourceApps && 'h-[348px]')}
                      label={t('createGuide.source.sourceApp')}
                      slotClassNames={{
                        viewport: cn('overscroll-contain rounded-md', shouldScrollSourceApps && 'h-[348px]'),
                        content: 'min-w-0 space-y-1 p-2',
                        scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
                      }}
                    >
                      {filteredApps.map(app => (
                        <SourceAppOption
                          key={app.id}
                          app={app}
                          selected={effectiveSelectedAppId === app.id}
                          onSelect={() => onSelectApp(app)}
                        />
                      ))}
                    </ScrollArea>
                  )}
          </div>
        </div>
      </div>
    </StepShell>
  )
}
