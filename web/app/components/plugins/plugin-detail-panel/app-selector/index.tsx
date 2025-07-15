'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AppTrigger from '@/app/components/plugins/plugin-detail-panel/app-selector/app-trigger'
import AppPicker from '@/app/components/plugins/plugin-detail-panel/app-selector/app-picker'
import AppInputsPanel from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-panel'
import type { App } from '@/types/app'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import useSWRInfinite from 'swr/infinite'
import { fetchAppList } from '@/service/apps'
import type { AppListResponse } from '@/models/app'

const PAGE_SIZE = 20

const getKey = (
  pageIndex: number,
  previousPageData: AppListResponse,
  searchText: string,
) => {
  if (pageIndex === 0 || (previousPageData && previousPageData.has_more)) {
    const params: any = {
      url: 'apps',
      params: {
        page: pageIndex + 1,
        limit: PAGE_SIZE,
        name: searchText,
      },
    }

    return params
  }
  return null
}

type Props = {
  value?: {
    app_id: string
    inputs: Record<string, any>
    files?: any[]
  }
  scope?: string
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  onSelect: (app: {
    app_id: string
    inputs: Record<string, any>
    files?: any[]
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

  const { data, isLoading, setSize } = useSWRInfinite(
    (pageIndex: number, previousPageData: AppListResponse) => getKey(pageIndex, previousPageData, searchText),
    fetchAppList,
    {
      revalidateFirstPage: true,
      shouldRetryOnError: false,
      dedupingInterval: 500,
      errorRetryCount: 3,
    },
  )

  const displayedApps = useMemo(() => {
    if (!data) return []
    return data.flatMap(({ data: apps }) => apps)
  }, [data])

  const hasMore = data?.at(-1)?.has_more ?? true

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      await setSize((size: number) => size + 1)
    }
 finally {
      // Add a small delay to ensure state updates are complete
      setTimeout(() => {
        setIsLoadingMore(false)
      }, 300)
    }
  }, [isLoadingMore, hasMore, setSize])

  const handleTriggerClick = () => {
    if (disabled) return
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

  const handleFormChange = (inputs: Record<string, any>) => {
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

  const currentAppInfo = useMemo(() => {
    if (!displayedApps || !value)
      return undefined
    return displayedApps.find(app => app.id === value.app_id)
  }, [displayedApps, value])

  return (
    <>
      <PortalToFollowElem
        placement={placement}
        offset={offset}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          className='w-full'
          onClick={handleTriggerClick}
        >
          <AppTrigger
            open={isShow}
            appDetail={currentAppInfo}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className="relative min-h-20 w-[389px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
            <div className='flex flex-col gap-1 px-4 py-3'>
              <div className='system-sm-semibold flex h-6 items-center text-text-secondary'>{t('app.appSelector.label')}</div>
              <AppPicker
                placement='bottom'
                offset={offset}
                trigger={
                  <AppTrigger
                    open={isShowChooseApp}
                    appDetail={currentAppInfo}
                  />
                }
                isShow={isShowChooseApp}
                onShowChange={setIsShowChooseApp}
                disabled={false}
                onSelect={handleSelectApp}
                scope={scope || 'all'}
                apps={displayedApps}
                isLoading={isLoading || isLoadingMore}
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
