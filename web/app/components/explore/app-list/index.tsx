'use client'

import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import type { TryAppSelection } from '@/types/try-app'
import { useDebounceFn } from 'ahooks'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DSLConfirmModal from '@/app/components/app/create-from-dsl-modal/dsl-confirm-modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import AppCard from '@/app/components/explore/app-card'
import Banner from '@/app/components/explore/banner/banner'
import Category from '@/app/components/explore/category'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useImportDSL } from '@/hooks/use-import-dsl'
import {
  DSLImportMode,
} from '@/models/app'
import { fetchAppDetail } from '@/service/explore'
import { useMembers } from '@/service/use-common'
import { useExploreAppList } from '@/service/use-explore'
import { cn } from '@/utils/classnames'
import TryApp from '../try-app'
import s from './style.module.css'

type AppsProps = {
  onSuccess?: () => void
}

const Apps = ({
  onSuccess,
}: AppsProps) => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const { systemFeatures } = useGlobalPublicStore()
  const { data: membersData } = useMembers()
  const allCategoriesEn = t('apps.allCategories', { ns: 'explore', lng: 'en' })
  const userAccount = membersData?.accounts?.find(account => account.id === userProfile.id)
  const hasEditPermission = !!userAccount && userAccount.role !== 'normal'

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

  const hasFilterCondition = !!keywords
  const handleResetFilter = useCallback(() => {
    setKeywords('')
    setSearchKeywords('')
  }, [])

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const [currCategory, setCurrCategory] = useQueryState('category', {
    defaultValue: allCategoriesEn,
  })

  const {
    data,
    isLoading,
    isError,
  } = useExploreAppList()

  const filteredList = useMemo(() => {
    if (!data)
      return []
    return data.allList.filter(item => currCategory === allCategoriesEn || item.category === currCategory)
  }, [data, currCategory, allCategoriesEn])

  const searchFilteredList = useMemo(() => {
    if (!searchKeywords || !filteredList || filteredList.length === 0)
      return filteredList

    const lowerCaseSearchKeywords = searchKeywords.toLowerCase()

    return filteredList.filter(item =>
      item.app && item.app.name && item.app.name.toLowerCase().includes(lowerCaseSearchKeywords),
    )
  }, [searchKeywords, filteredList])

  const [currApp, setCurrApp] = useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = useState(false)

  const {
    handleImportDSL,
    handleImportDSLConfirm,
    versions,
    isFetching,
  } = useImportDSL()
  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)

  const [currentTryApp, setCurrentTryApp] = useState<TryAppSelection | undefined>(undefined)
  const isShowTryAppPanel = !!currentTryApp
  const hideTryAppPanel = useCallback(() => {
    setCurrentTryApp(undefined)
  }, [])
  const handleTryApp = useCallback((params: TryAppSelection) => {
    setCurrentTryApp(params)
  }, [])
  const handleShowFromTryApp = useCallback(() => {
    setCurrApp(currentTryApp?.app || null)
    setIsShowCreateModal(true)
  }, [currentTryApp?.app])

  const onCreate: CreateAppModalProps['onConfirm'] = async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
  }) => {
    hideTryAppPanel()

    const { export_data } = await fetchAppDetail(
      currApp?.app.id as string,
    )
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
      onSuccess: () => {
        setIsShowCreateModal(false)
      },
      onPending: () => {
        setShowDSLConfirmModal(true)
      },
    })
  }

  const onConfirmDSL = useCallback(async () => {
    await handleImportDSLConfirm({
      onSuccess,
    })
  }, [handleImportDSLConfirm, onSuccess])

  if (isLoading) {
    return (
      <div className="flex h-full items-center">
        <Loading type="area" />
      </div>
    )
  }

  if (isError || !data)
    return null

  const { categories } = data

  return (
    <div className={cn(
      'flex h-full min-h-0 flex-col overflow-hidden border-l-[0.5px] border-divider-regular',
    )}
    >
      <div className="flex flex-1 flex-col overflow-y-auto">
        {systemFeatures.enable_explore_banner && (
          <div className="mt-4 px-12">
            <Banner />
          </div>
        )}

        <div className="sticky top-0 z-10 bg-background-body">
          <div className={cn(
            'flex items-center justify-between px-12 pt-6',
          )}
          >
            <div className="flex items-center">
              <div className="grow truncate text-text-primary system-xl-semibold">{!hasFilterCondition ? t('apps.title', { ns: 'explore' }) : t('apps.resultNum', { num: searchFilteredList.length, ns: 'explore' })}</div>
              {hasFilterCondition && (
                <>
                  <div className="mx-3 h-4 w-px bg-divider-regular"></div>
                  <Button size="medium" onClick={handleResetFilter}>{t('apps.resetFilter', { ns: 'explore' })}</Button>
                </>
              )}
            </div>
            <Input
              showLeftIcon
              showClearIcon
              wrapperClassName="w-[200px] self-start"
              value={keywords}
              onChange={e => handleKeywordsChange(e.target.value)}
              onClear={() => handleKeywordsChange('')}
            />
          </div>

          <div className="px-12 pb-4 pt-2">
            <Category
              list={categories}
              value={currCategory}
              onChange={setCurrCategory}
              allCategoriesEn={allCategoriesEn}
            />
          </div>
        </div>

        <div className={cn(
          'relative flex flex-1 shrink-0 grow flex-col pb-6',
        )}
        >
          <nav
            className={cn(
              s.appList,
              'grid shrink-0 content-start gap-4 px-6 sm:px-12',
            )}
          >
            {searchFilteredList.map(app => (
              <AppCard
                key={app.app_id}
                app={app}
                canCreate={hasEditPermission}
                onCreate={() => {
                  setCurrApp(app)
                  setIsShowCreateModal(true)
                }}
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
      {
        showDSLConfirmModal && (
          <DSLConfirmModal
            versions={versions}
            onCancel={() => setShowDSLConfirmModal(false)}
            onConfirm={onConfirmDSL}
            confirmDisabled={isFetching}
          />
        )
      }

      {isShowTryAppPanel && (
        <TryApp
          appId={currentTryApp?.appId || ''}
          app={currentTryApp?.app}
          category={currentTryApp?.app?.category}
          onClose={hideTryAppPanel}
          onCreate={handleShowFromTryApp}
        />
      )}
    </div>
  )
}

export default React.memo(Apps)
