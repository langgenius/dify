'use client'
import type { SourceAppPickerValue } from './source-app-picker-value'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
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
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { TitleTooltip } from '../../components/title-tooltip'
import { isWorkflowApp } from './source-app-mode'

const SOURCE_APP_PAGE_SIZE = 20
const SOURCE_APP_PICKER_SKELETON_KEYS = ['first-source-app', 'second-source-app', 'third-source-app']

function sourceAppSearchText(app: App) {
  return `${app.name} ${app.id}`.toLowerCase()
}

function SourceAppTrigger({ open, app }: {
  open: boolean
  app?: SourceAppPickerValue
}) {
  const { t } = useTranslation('deployments')

  return (
    <span
      className={cn(
        'group flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-transparent bg-components-input-bg-normal px-3 text-left hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        open && 'border-components-input-border-active bg-components-input-bg-active shadow-xs',
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
          'i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
          open && 'text-text-secondary',
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

export function SourceAppPicker({ value, onChange, ariaLabel }: {
  value?: SourceAppPickerValue
  onChange: (app: App) => void
  ariaLabel?: string
}) {
  const { t } = useTranslation('deployments')
  const [isShow, setIsShow] = useState(false)
  const [searchText, setSearchText] = useState('')

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          page: Number(pageParam),
          limit: SOURCE_APP_PAGE_SIZE,
          name: searchText,
          mode: AppModeEnum.WORKFLOW,
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })

  const apps = data?.pages.flatMap(page => page.data).filter(isWorkflowApp) ?? []

  return (
    <Combobox<App>
      items={apps}
      open={isShow}
      inputValue={searchText}
      onOpenChange={setIsShow}
      onInputValueChange={setSearchText}
      onValueChange={(app) => {
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
      disabled={false}
    >
      <ComboboxTrigger
        aria-label={ariaLabel ?? t('createModal.sourceApp')}
        icon={false}
        className="block h-auto w-full border-0 bg-transparent p-0 text-left hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 data-open:bg-transparent"
      >
        <SourceAppTrigger open={isShow} app={value} />
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
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
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
            {hasNextPage && (
              <div className="flex justify-center px-3 py-2">
                <Button
                  type="button"
                  size="small"
                  disabled={isFetchingNextPage}
                  onClick={() => {
                    void fetchNextPage()
                  }}
                >
                  {isFetchingNextPage ? t('createModal.loadingApps') : t('createModal.loadMoreApps')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </ComboboxContent>
    </Combobox>
  )
}
