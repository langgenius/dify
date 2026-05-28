'use client'

import type { Placement } from '@langgenius/dify-ui/popover'
import type { App } from '@/types/app'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppInputsPanel from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-panel'
import { AppPicker } from '@/app/components/plugins/plugin-detail-panel/app-selector/app-picker'
import { AppTrigger } from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import { consoleQuery } from '@/service/client'
import { useAppDetail } from '@/service/use-apps'

const PAGE_SIZE = 20

export type AppSelectorValue = {
  app_id: string
  inputs: Record<string, unknown>
  files?: unknown[]
}

type AppSelectorProps = {
  value?: AppSelectorValue
  scope?: string
  disabled?: boolean
  placement?: Placement
  offset?: number
  onSelect: (app: AppSelectorValue) => void
}

export function AppSelector({
  value,
  disabled,
  placement = 'bottom',
  offset = 4,
  onSelect,
}: AppSelectorProps) {
  const { t } = useTranslation()
  const [isShow, setIsShow] = useState(false)
  const [isShowChooseApp, setIsShowChooseApp] = useState(false)
  const [searchText, setSearchText] = useState('')

  const appListQuery = useMemo(() => ({
    page: 1,
    limit: PAGE_SIZE,
    name: searchText,
  }), [searchText])

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
          ...appListQuery,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })

  const displayedApps = useMemo(() => {
    return data?.pages.flatMap(({ data: apps }) => apps) ?? []
  }, [data?.pages])

  const { data: selectedAppDetail } = useAppDetail(value?.app_id || '')

  const currentAppInfo = useMemo(() => {
    if (!value?.app_id)
      return undefined

    return selectedAppDetail || displayedApps.find(app => app.id === value.app_id)
  }, [displayedApps, selectedAppDetail, value?.app_id])

  const hasMore = hasNextPage ?? true

  const handleSelectApp = useCallback((app: App) => {
    const shouldClearValue = app.id !== value?.app_id

    onSelect({
      app_id: app.id,
      inputs: shouldClearValue ? {} : value?.inputs || {},
      files: shouldClearValue ? [] : value?.files || [],
    })
  }, [onSelect, value?.app_id, value?.files, value?.inputs])

  const handleFormChange = useCallback((inputs: Record<string, unknown>) => {
    const newFiles = inputs['#image#']
    const nextInputs = { ...inputs }
    delete nextInputs['#image#']

    onSelect({
      app_id: value?.app_id || '',
      inputs: nextInputs,
      files: newFiles ? [newFiles] : value?.files || [],
    })
  }, [onSelect, value?.app_id, value?.files])

  const formattedValue = useMemo(() => ({
    app_id: value?.app_id || '',
    inputs: {
      ...value?.inputs,
      ...(value?.files?.length ? { '#image#': value.files[0] } : {}),
    },
  }), [value])

  return (
    <Popover
      open={isShow}
      onOpenChange={setIsShow}
    >
      <PopoverTrigger
        aria-label={t('appSelector.label', { ns: 'app' })}
        disabled={disabled}
        render={<button type="button" className="block w-full border-0 bg-transparent p-0 text-left" />}
      >
        <AppTrigger
          open={isShow}
          appDetail={currentAppInfo}
        />
      </PopoverTrigger>
      <PopoverContent
        placement={placement}
        sideOffset={offset}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="relative min-h-20 w-[389px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs">
          <div className="flex flex-col gap-1 px-4 py-3">
            <div className="flex h-6 items-center system-sm-semibold text-text-secondary">{t('appSelector.label', { ns: 'app' })}</div>
            <AppPicker
              placement="bottom"
              offset={offset}
              trigger={(
                <AppTrigger
                  open={isShowChooseApp}
                  appDetail={currentAppInfo}
                />
              )}
              isShow={isShowChooseApp}
              onShowChange={setIsShowChooseApp}
              disabled={false}
              onSelect={handleSelectApp}
              apps={displayedApps}
              isLoading={isLoading || isFetchingNextPage}
              hasMore={hasMore}
              onLoadMore={() => {
                void fetchNextPage()
              }}
              searchText={searchText}
              onSearchChange={setSearchText}
            />
          </div>
          {currentAppInfo && (
            <AppInputsPanel
              value={formattedValue}
              appDetail={currentAppInfo}
              onFormChange={handleFormChange}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
