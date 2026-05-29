'use client'

import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import type { TrackCreateAppParams } from '@/utils/create-app-tracking'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DSLConfirmModal from '@/app/components/app/create-from-dsl-modal/dsl-confirm-modal'
import AppCard from '@/app/components/explore/app-card'
import Banner from '@/app/components/explore/banner/banner'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import { useAppContext } from '@/context/app-context'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { DSLImportMode } from '@/models/app'
import { consoleQuery } from '@/service/client'
import { fetchAppDetail } from '@/service/explore'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useMembers } from '@/service/use-common'
import { useExploreAppList } from '@/service/use-explore'
import { trackCreateApp } from '@/utils/create-app-tracking'
import TryApp from '../try-app'
import { ExploreAppListHeader } from './explore-app-list-header'
import { ExploreRecommendations } from './explore-recommendations'
import { ExploreAppListSkeleton, ExploreHeaderSkeleton } from './loading-skeletons'
import s from './style.module.css'

function useHomeContinueWorkApps() {
  return useQuery(consoleQuery.apps.list.queryOptions({
    input: {
      query: {
        page: 1,
        limit: 8,
        name: '',
      },
    },
    staleTime: 0,
    gcTime: 0,
  }))
}

const Apps = ({ onSuccess }: { onSuccess?: () => void }) => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(
    systemFeaturesQueryOptions(),
  )
  const { data: membersData } = useMembers()
  const allCategoriesEn = t('apps.allCategories', { ns: 'explore', lng: 'en' })
  const userAccount = membersData?.accounts?.find(
    account => account.id === userProfile.id,
  )
  const hasEditPermission = !!userAccount && userAccount.role !== 'normal'

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

  const { run: handleSearch } = useDebounceFn(
    () => {
      setSearchKeywords(keywords)
    },
    { wait: 500 },
  )

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const [currCategory, setCurrCategory] = useQueryState('category', {
    defaultValue: allCategoriesEn,
  })

  const { data, isLoading, isError } = useExploreAppList()
  const { isLoading: isContinueWorkLoading } = useHomeContinueWorkApps()

  const filteredList = useMemo(() => {
    if (!data)
      return []
    return data.allList.filter(
      item =>
        currCategory === allCategoriesEn
        || item.categories?.includes(currCategory),
    )
  }, [data, currCategory, allCategoriesEn])

  const searchFilteredList = useMemo(() => {
    if (!searchKeywords || !filteredList || filteredList.length === 0)
      return filteredList

    const lowerCaseSearchKeywords = searchKeywords.toLowerCase()

    return filteredList.filter(
      item =>
        item.app
        && item.app.name
        && item.app.name.toLowerCase().includes(lowerCaseSearchKeywords),
    )
  }, [searchKeywords, filteredList])

  const [currApp, setCurrApp] = useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = useState(false)

  const { handleImportDSL, handleImportDSLConfirm, versions, isFetching }
    = useImportDSL()
  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)

  const [currentTryApp, setCurrentTryApp] = useState<
    TryAppSelection | undefined
  >(undefined)
  const currentCreateAppModeRef = useRef<App['app']['mode'] | null>(null)
  const currentCreateAppTrackingRef = useRef<Pick<
    TrackCreateAppParams,
    'source' | 'templateId'
  > | null>(null)
  const isShowTryAppPanel = !!currentTryApp
  const hideTryAppPanel = useCallback(() => {
    setCurrentTryApp(undefined)
  }, [])
  const handleTryApp = useCallback((params: TryAppSelection) => {
    setCurrentTryApp(params)
  }, [])
  const handleShowFromTryApp = useCallback(() => {
    setCurrApp(currentTryApp?.app || null)
    currentCreateAppTrackingRef.current = {
      source: 'explore_template_preview',
      templateId: currentTryApp?.appId || currentTryApp?.app.app_id,
    }
    setIsShowCreateModal(true)
  }, [currentTryApp?.app, currentTryApp?.appId])
  const handleCreateFromLearnDify = useCallback((app: App) => {
    setCurrApp(app)
    setIsShowCreateModal(true)
  }, [])
  const handleCreateFromAppList = useCallback((app: App) => {
    currentCreateAppTrackingRef.current = {
      source: 'explore_template_list',
      templateId: app.app_id,
    }
    setCurrApp(app)
    setIsShowCreateModal(true)
  }, [])
  const trackCurrentCreateApp = useCallback(
    (appMode?: App['app']['mode'] | null) => {
      const currentCreateAppTracking = currentCreateAppTrackingRef.current
      const resolvedAppMode = appMode ?? currentCreateAppModeRef.current
      if (!resolvedAppMode || !currentCreateAppTracking)
        return

      trackCreateApp({
        ...currentCreateAppTracking,
        appMode: resolvedAppMode,
      })
      currentCreateAppTrackingRef.current = null
      currentCreateAppModeRef.current = null
    },
    [],
  )

  const onCreate: CreateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background, description }) => {
      hideTryAppPanel()

      const { export_data, mode } = await fetchAppDetail(
        currApp?.app.id as string,
      )
      currentCreateAppModeRef.current = mode
      const payload = {
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: export_data,
        name,
        icon_type,
        icon,
        icon_background,
        description,
      }
      await handleImportDSL(payload, {
        onSuccess: (response) => {
          trackCurrentCreateApp(response.app_mode)
          setIsShowCreateModal(false)
        },
        onPending: () => {
          setShowDSLConfirmModal(true)
        },
      })
    },
    [currApp?.app.id, handleImportDSL, hideTryAppPanel, trackCurrentCreateApp],
  )

  const onConfirmDSL = useCallback(async () => {
    await handleImportDSLConfirm({
      onSuccess: (response) => {
        trackCurrentCreateApp(response.app_mode)
        onSuccess?.()
      },
    })
  }, [handleImportDSLConfirm, onSuccess, trackCurrentCreateApp])

  const hasFilterCondition
    = !!keywords
      || !!searchKeywords
      || currCategory !== allCategoriesEn
      || searchFilteredList.length !== filteredList.length

  if (isError || (!isLoading && !data))
    return null

  const categories = data?.categories ?? []

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden border-l-[0.5px] border-divider-regular',
      )}
    >
      <div className="flex flex-1 flex-col overflow-y-auto">
        {systemFeatures.enable_explore_banner && (
          <div className="mt-4 px-12">
            <Banner />
          </div>
        )}
        <ExploreRecommendations
          canCreate={hasEditPermission}
          isContinueWorkLoading={isContinueWorkLoading}
          onCreate={handleCreateFromLearnDify}
          onTry={handleTryApp}
        />

        {isLoading
          ? <ExploreHeaderSkeleton />
          : (
              <ExploreAppListHeader
                allCategoriesEn={allCategoriesEn}
                categories={categories}
                currCategory={currCategory}
                hasFilterCondition={hasFilterCondition}
                keywords={keywords}
                resultCount={searchFilteredList.length}
                onCategoryChange={setCurrCategory}
                onKeywordsChange={handleKeywordsChange}
              />
            )}

        <div className={cn('relative flex flex-1 shrink-0 grow flex-col pb-6')}>
          <nav
            className={cn(
              s.appList,
              'grid shrink-0 content-start gap-3 px-6 sm:px-12',
            )}
          >
            {isLoading
              ? <ExploreAppListSkeleton />
              : searchFilteredList.map(app => (
                  <AppCard
                    key={app.app_id}
                    app={app}
                    canCreate={hasEditPermission}
                    onCreate={() => handleCreateFromAppList(app)}
                    onTry={handleTryApp}
                  />
                ))}
          </nav>
        </div>
      </div>
      {isShowCreateModal && (
        <CreateAppModal
          appIconType={currApp?.app.icon_type || 'emoji'}
          appIcon={currApp?.app.icon || ''}
          appIconBackground={currApp?.app.icon_background || ''}
          appIconUrl={currApp?.app.icon_url}
          appName={currApp?.app.name || ''}
          appDescription={currApp?.app.description || ''}
          show={isShowCreateModal}
          onConfirm={onCreate}
          confirmDisabled={isFetching}
          onHide={() => setIsShowCreateModal(false)}
        />
      )}
      {showDSLConfirmModal && (
        <DSLConfirmModal
          versions={versions}
          onCancel={() => setShowDSLConfirmModal(false)}
          onConfirm={onConfirmDSL}
          confirmDisabled={isFetching}
        />
      )}

      {isShowTryAppPanel && (
        <TryApp
          appId={currentTryApp?.appId || ''}
          app={currentTryApp?.app}
          categories={currentTryApp?.app?.categories}
          onClose={hideTryAppPanel}
          onCreate={handleShowFromTryApp}
        />
      )}
    </div>
  )
}

export default React.memo(Apps)
