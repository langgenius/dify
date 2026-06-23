'use client'
import type { SourceAppPickerValue } from '../state'
import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { useInfiniteScroll } from '@/features/deployments/shared/hooks/use-infinite-scroll'
import { TitleTooltip } from '../../shared/components/title-tooltip'
import {
  createReleaseSourceAppSearchTextAtom,
  createReleaseSourceAppsQueryAtom,
} from '../state'

const SOURCE_APP_PICKER_SKELETON_KEYS = ['first-source-app', 'second-source-app', 'third-source-app']

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id}`.toLowerCase()
}

function SourceAppTrigger({ app }: {
  app?: SourceAppPickerValue
}) {
  const { t } = useTranslation('deployments')

  return (
    <span
      className={cn(
        'flex h-10 items-center gap-2 rounded-lg border border-transparent bg-components-input-bg-normal px-3 text-left',
        'cursor-pointer hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'group-data-disabled/combobox-trigger:cursor-not-allowed group-data-disabled/combobox-trigger:text-components-input-text-disabled group-data-disabled/combobox-trigger:hover:border-transparent group-data-disabled/combobox-trigger:hover:bg-components-input-bg-normal',
        'group-data-popup-open/combobox-trigger:border-components-input-border-active group-data-popup-open/combobox-trigger:bg-components-input-bg-active group-data-popup-open/combobox-trigger:shadow-xs',
        app && 'pl-2',
      )}
    >
      {app && (
        <AppIcon
          className="shrink-0"
          size="xs"
          iconType={app.icon_type}
          icon={app.icon}
          background={app.icon_background}
          imageUrl={app.icon_url}
        />
      )}
      <TitleTooltip content={app?.name}>
        <span
          className={cn(
            'min-w-0 grow truncate',
            app
              ? 'system-sm-medium text-components-input-text-filled'
              : 'system-sm-regular text-components-input-text-placeholder',
          )}
        >
          {app?.name ?? t('createModal.appPickerPlaceholder')}
        </span>
      </TitleTooltip>
      <span
        className={cn(
          'i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-hover/combobox-trigger:text-text-secondary',
          'group-data-disabled/combobox-trigger:text-text-quaternary group-data-disabled/combobox-trigger:opacity-50',
          'group-data-popup-open/combobox-trigger:text-text-secondary',
        )}
        aria-hidden="true"
      />
    </span>
  )
}

function SourceAppOption({ app }: {
  app: App
}) {
  return (
    <ComboboxItem
      value={app}
      className="mx-0 grid-cols-[minmax(0,1fr)] gap-3 py-1 pr-3 pl-2"
    >
      <ComboboxItemText className="flex min-w-0 items-center gap-3 px-0">
        <AppIcon
          className="shrink-0"
          size="xs"
          iconType={app.icon_type}
          icon={app.icon}
          background={app.icon_background}
          imageUrl={app.icon_url}
        />
        <TitleTooltip content={`${app.name} (${app.id})`}>
          <span className="flex min-w-0 grow items-center gap-1 truncate system-sm-medium text-components-input-text-filled">
            <span className="truncate">{app.name}</span>
            <span className="shrink-0 text-text-tertiary">
              (
              {app.id.slice(0, 8)}
              )
            </span>
          </span>
        </TitleTooltip>
      </ComboboxItemText>
    </ComboboxItem>
  )
}

function SourceAppPickerSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {SOURCE_APP_PICKER_SKELETON_KEYS.map(key => (
        <SkeletonRow key={key} className="h-7 gap-3">
          <SkeletonRectangle className="my-0 size-5 animate-pulse rounded-md" />
          <SkeletonRectangle className="h-3 w-32 animate-pulse" />
        </SkeletonRow>
      ))}
    </div>
  )
}

export function SourceAppPicker({ value, onChange, disabled = false }: {
  value?: SourceAppPickerValue
  onChange: (app: App) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('deployments')
  const [isShow, setIsShow] = useState(false)
  const searchText = useAtomValue(createReleaseSourceAppSearchTextAtom)
  const setSearchText = useSetAtom(createReleaseSourceAppSearchTextAtom)
  const sourceAppsQuery = useAtomValue(createReleaseSourceAppsQueryAtom)
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
  } = sourceAppsQuery
  const { rootRef, sentinelRef } = useInfiniteScroll<HTMLDivElement>(sourceAppsQuery, {
    enabled: isShow && !disabled,
    rootMargin: '0px 0px 160px 0px',
    threshold: 0.1,
  })

  const apps = data?.pages.flatMap(page => page.data) ?? []

  return (
    <Combobox<App>
      items={apps}
      open={!disabled && isShow}
      inputValue={searchText}
      onOpenChange={(open) => {
        setIsShow(disabled ? false : open)
      }}
      onInputValueChange={(value) => {
        if (!disabled)
          setSearchText(value)
      }}
      onValueChange={(app) => {
        if (disabled)
          return
        if (!app)
          return
        onChange(app)
        setIsShow(false)
      }}
      itemToStringLabel={(app) => {
        if (!app)
          return ''

        return app.name
      }}
      itemToStringValue={(app) => {
        if (!app)
          return ''

        return app.id
      }}
      filter={(app, query) => sourceAppSearchText(app).includes(query.toLowerCase())}
      disabled={disabled}
    >
      <ComboboxTrigger
        aria-label={t('versions.sourceAppOption')}
        icon={false}
        className="block h-auto w-full border-0 bg-transparent p-0 text-left hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 data-open:bg-transparent"
      >
        <SourceAppTrigger app={value} />
      </ComboboxTrigger>
      <ComboboxContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="relative flex max-h-100 min-h-20 w-89 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="p-2 pb-1">
            <ComboboxInputGroup className="h-8 min-h-8 px-2">
              <span className="i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
              <ComboboxInput
                aria-label={t('createModal.appSearchPlaceholder')}
                placeholder={t('createModal.appSearchPlaceholder')}
                className="block h-4.5 grow px-1 py-0 text-[13px] text-text-primary"
              />
            </ComboboxInputGroup>
          </div>
          <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto p-1">
            {(isLoading || isFetchingNextPage) && apps.length === 0 && <SourceAppPickerSkeleton />}
            <ComboboxList className="max-h-none p-0">
              {(app: App) => (
                <SourceAppOption key={app.id} app={app} />
              )}
            </ComboboxList>
            {!(isLoading || isFetchingNextPage) && (
              <ComboboxEmpty>
                {t('createModal.appSearchEmpty')}
              </ComboboxEmpty>
            )}
            {isFetchingNextPage && apps.length > 0 && (
              <div className="px-3 py-2 text-center system-xs-regular text-text-tertiary">
                {t('createModal.loadingApps')}
              </div>
            )}
            {hasNextPage && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
          </div>
        </div>
      </ComboboxContent>
    </Combobox>
  )
}
