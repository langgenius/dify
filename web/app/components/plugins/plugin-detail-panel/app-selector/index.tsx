'use client'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import type { FC } from 'react'
import type { App } from '@/types/app'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AppInputsPanel from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-panel'
import AppPicker from '@/app/components/plugins/plugin-detail-panel/app-selector/app-picker'
import AppTrigger from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import { useAppDetail, useInfiniteAppList } from '@/service/use-apps'

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
  const [isShow, onShowChange] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteAppList({
    page: 1,
    limit: PAGE_SIZE,
    name: searchText,
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

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || isFetchingNextPage || !hasMore)
      return

    setIsLoadingMore(true)
    try {
      await fetchNextPage()
    }
    finally {
      // Add a small delay to ensure state updates are complete
      setTimeout(() => {
        setIsLoadingMore(false)
      }, 300)
    }
  }, [isLoadingMore, isFetchingNextPage, hasMore, fetchNextPage])

  const handleTriggerClick = () => {
    if (disabled)
      return
    onShowChange(true)
  }

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
      <PortalToFollowElem
        placement={placement}
        offset={offset}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          className="w-full"
          onClick={handleTriggerClick}
        >
          <AppTrigger
            open={isShow}
            appDetail={currentAppInfo}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[1000]">
          <div className="relative min-h-20 w-[389px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
            <div className="flex flex-col gap-1 px-4 py-3">
              <div className="system-sm-semibold flex h-6 items-center text-text-secondary">{t('appSelector.label', { ns: 'app' })}</div>
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
                isLoading={isLoading || isLoadingMore || isFetchingNextPage}
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
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}

export default React.memo(AppSelector)
