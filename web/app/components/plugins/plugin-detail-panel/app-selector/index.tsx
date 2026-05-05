'use client'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { FC } from 'react'
import type { AppListQuery } from '@/contract/console/apps'
import type { App } from '@/types/app'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppInputsPanel from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-panel'
import AppPicker from '@/app/components/plugins/plugin-detail-panel/app-selector/app-picker'
import AppTrigger from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import { consoleQuery } from '@/service/client'
import { useAppDetail } from '@/service/use-apps'

const PAGE_SIZE = 20

type Props = {
  value?: {
    app_id: string
    inputs: Record<string, unknown>
    files?: unknown[]
  }
  scope?: string
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  onSelect: (app: {
    app_id: string
    inputs: Record<string, unknown>
    files?: unknown[]
  }) => void
  supportAddCustomTool?: boolean
}

const AppSelector: FC<Props> = ({
  value,
  scope,
  disabled,
  placement = 'bottom',
  offset = 4,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [isShow, setIsShow] = useState(false)
  const [searchText, setSearchText] = useState('')

  const appListQuery = useMemo<AppListQuery>(() => ({
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
    const pages = data?.pages ?? []
    if (!pages.length)
      return []
    return pages.flatMap(({ data: apps }) => apps)
  }, [data?.pages])

  // fetch selected app by id to avoid pagination gaps
  const { data: selectedAppDetail } = useAppDetail(value?.app_id || '')

  // Ensure the currently selected app is available for display and in the picker options
  const currentAppInfo = useMemo(() => {
    if (!value?.app_id)
      return undefined
    return selectedAppDetail || displayedApps.find(app => app.id === value.app_id)
  }, [value?.app_id, selectedAppDetail, displayedApps])

  const appsForPicker = useMemo(() => {
    if (!currentAppInfo)
      return displayedApps

    const appIndex = displayedApps.findIndex(a => a.id === currentAppInfo.id)

    if (appIndex === -1)
      return [currentAppInfo, ...displayedApps]

    const updatedApps = [...displayedApps]
    updatedApps[appIndex] = currentAppInfo
    return updatedApps
  }, [currentAppInfo, displayedApps])

  const hasMore = hasNextPage ?? true
  const resolvedOffset = typeof offset === 'number' || typeof offset === 'function' ? undefined : offset
  const sideOffset = typeof offset === 'number' ? offset : resolvedOffset?.mainAxis ?? 0
  const alignOffset = typeof offset === 'number' ? 0 : resolvedOffset?.crossAxis ?? resolvedOffset?.alignmentAxis ?? 0

  const handleLoadMore = useCallback(async () => {
    if (isFetchingNextPage || !hasMore)
      return

    await fetchNextPage()
  }, [fetchNextPage, hasMore, isFetchingNextPage])

  const handleTriggerClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    if (disabled || isShow)
      return

    setIsShow(true)
  }, [disabled, isShow])

  const [isShowChooseApp, setIsShowChooseApp] = useState(false)
  const handleSelectApp = (app: App) => {
    const clearValue = app.id !== value?.app_id
    const appValue = {
      app_id: app.id,
      inputs: clearValue ? {} : value?.inputs || {},
      files: clearValue ? [] : value?.files || [],
    }
    onSelect(appValue)
    setIsShowChooseApp(false)
  }

  const handleFormChange = (inputs: Record<string, unknown>) => {
    const newFiles = inputs['#image#']
    delete inputs['#image#']
    const newValue = {
      app_id: value?.app_id || '',
      inputs,
      files: newFiles ? [newFiles] : value?.files || [],
    }
    onSelect(newValue)
  }

  const formattedValue = useMemo(() => {
    return {
      app_id: value?.app_id || '',
      inputs: {
        ...value?.inputs,
        ...(value?.files?.length ? { '#image#': value.files[0] } : {}),
      },
    }
  }, [value])

  return (
    <>
      <Popover
        open={isShow}
        onOpenChange={setIsShow}
      >
        <PopoverTrigger
          render={(
            <div className="w-full">
              <AppTrigger
                open={isShow}
                appDetail={currentAppInfo}
              />
            </div>
          )}
          onClick={handleTriggerClick}
        />
        <PopoverContent
          placement={placement}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
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
                scope={scope || 'all'}
                apps={appsForPicker}
                isLoading={isLoading || isFetchingNextPage}
                hasMore={hasMore}
                onLoadMore={handleLoadMore}
                searchText={searchText}
                onSearchChange={setSearchText}
              />
            </div>
            {/* app inputs config panel */}
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
    </>
  )
}

export default React.memo(AppSelector)
