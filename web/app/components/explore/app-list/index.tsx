'use client'

import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { useDebounceFn } from 'ahooks'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import DSLConfirmModal from '@/app/components/app/create-from-dsl-modal/dsl-confirm-modal'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import AppCard from '@/app/components/explore/app-card'
import Category from '@/app/components/explore/category'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import ExploreContext from '@/context/explore-context'
import { useImportDSL } from '@/hooks/use-import-dsl'
import {
  DSLImportMode,
} from '@/models/app'
import { fetchAppDetail } from '@/service/explore'
import { useExploreAppList } from '@/service/use-explore'
import { cn } from '@/utils/classnames'
import s from './style.module.css'

type AppsProps = {
  onSuccess?: () => void
}

const Apps = ({
  onSuccess,
}: AppsProps) => {
  const { t } = useTranslation()
  const { hasEditPermission } = useContext(ExploreContext)
  const allCategoriesEn = t('apps.allCategories', { ns: 'explore', lng: 'en' })

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

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

  const [currApp, setCurrApp] = React.useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = React.useState(false)

  const {
    handleImportDSL,
    handleImportDSLConfirm,
    versions,
    isFetching,
  } = useImportDSL()
  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)
  const onCreate: CreateAppModalProps['onConfirm'] = async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
  }) => {
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
      'flex h-full flex-col border-l-[0.5px] border-divider-regular',
    )}
    >

      <div className="shrink-0 px-12 pt-6">
        <div className={`mb-1 ${s.textGradient} text-xl font-semibold`}>{t('apps.title', { ns: 'explore' })}</div>
        <div className="text-sm text-text-tertiary">{t('apps.description', { ns: 'explore' })}</div>
      </div>

      <div className={cn(
        'mt-6 flex items-center justify-between px-12',
      )}
      >
        <Category
          list={categories}
          value={currCategory}
          onChange={setCurrCategory}
          allCategoriesEn={allCategoriesEn}
        />
        <Input
          showLeftIcon
          showClearIcon
          wrapperClassName="w-[200px] self-start"
          value={keywords}
          onChange={e => handleKeywordsChange(e.target.value)}
          onClear={() => handleKeywordsChange('')}
        />
      </div>

      <div className={cn(
        'relative mt-4 flex flex-1 shrink-0 grow flex-col overflow-auto pb-6',
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
              isExplore
              app={app}
              canCreate={hasEditPermission}
              onCreate={() => {
                setCurrApp(app)
                setIsShowCreateModal(true)
              }}
            />
          ))}
        </nav>
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
    </div>
  )
}

export default React.memo(Apps)
