'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import useSWR from 'swr'
import { useDebounceFn } from 'ahooks'
import { RiRobot2Line } from '@remixicon/react'
import AppCard from '../app-card'
import Sidebar, { AppCategories, AppCategoryLabel } from './sidebar'
import Toast from '@/app/components/base/toast'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import ExploreContext from '@/context/explore-context'
import type { App } from '@/models/explore'
import { fetchAppDetail, fetchAppList } from '@/service/explore'
import { importDSL } from '@/service/apps'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import AppTypeSelector from '@/app/components/app/type-selector'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import Loading from '@/app/components/base/loading'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { getRedirection } from '@/utils/app-redirection'
import Input from '@/app/components/base/input'
import type { AppMode } from '@/types/app'
import { DSLImportMode } from '@/models/app'

type AppsProps = {
  onSuccess?: () => void
  onCreateFromBlank?: () => void
}

// export enum PageType {
//   EXPLORE = 'explore',
//   CREATE = 'create',
// }

const Apps = ({
  onSuccess,
  onCreateFromBlank,
}: AppsProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { push } = useRouter()
  const { hasEditPermission } = useContext(ExploreContext)
  const allCategoriesEn = AppCategories.RECOMMENDED

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const [currentType, setCurrentType] = useState<AppMode[]>([])
  const [currCategory, setCurrCategory] = useTabSearchParams({
    defaultTab: allCategoriesEn,
    disableSearchParams: true,
  })

  const {
    data: { categories, allList },
  } = useSWR(
    ['/explore/apps'],
    () =>
      fetchAppList().then(({ categories, recommended_apps }) => ({
        categories,
        allList: recommended_apps.sort((a, b) => a.position - b.position),
      })),
    {
      fallbackData: {
        categories: [],
        allList: [],
      },
    },
  )

  const filteredList = useMemo(() => {
    const filteredByCategory = allList.filter((item) => {
      if (currCategory === allCategoriesEn)
        return true
      return item.category === currCategory
    })
    if (currentType.length === 0)
      return filteredByCategory
    return filteredByCategory.filter((item) => {
      if (currentType.includes('chat') && item.app.mode === 'chat')
        return true
      if (currentType.includes('advanced-chat') && item.app.mode === 'advanced-chat')
        return true
      if (currentType.includes('agent-chat') && item.app.mode === 'agent-chat')
        return true
      if (currentType.includes('completion') && item.app.mode === 'completion')
        return true
      if (currentType.includes('workflow') && item.app.mode === 'workflow')
        return true
      return false
    })
  }, [currentType, currCategory, allCategoriesEn, allList])

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
    try {
      const app = await importDSL({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: export_data,
        name,
        icon_type,
        icon,
        icon_background,
        description,
      })
      setIsShowCreateModal(false)
      Toast.notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      if (onSuccess)
        onSuccess()
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(isCurrentWorkspaceEditor, { id: app.app_id }, push)
    }
    catch (e) {
      Toast.notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
  }

  if (!categories || categories.length === 0) {
    return (
      <div className="flex h-full items-center">
        <Loading type="area" />
      </div>
    )
  }

  return (
    <div className='h-full flex flex-col'>
      <div className='flex justify-between items-center py-3 border-b border-divider-burn'>
        <div className='min-w-[180px] pl-5'>
          <span className='title-xl-semi-bold text-text-primary'>{t('app.newApp.startFromTemplate')}</span>
        </div>
        <div className='flex-1 max-w-[548px] p-1.5 flex items-center rounded-xl shadow-md bg-components-panel-bg-blur border border-components-panel-border'>
          <AppTypeSelector value={currentType} onChange={setCurrentType} />
          <div className='h-[14px]'>
            <Divider type='vertical' />
          </div>
          <Input
            showClearIcon
            wrapperClassName='w-full flex-1'
            className='bg-transparent hover:bg-transparent focus:bg-transparent hover:border-transparent focus:border-transparent focus:shadow-none'
            placeholder={t('app.newAppFromTemplate.searchAllTemplate') as string}
            value={keywords}
            onChange={e => handleKeywordsChange(e.target.value)}
            onClear={() => handleKeywordsChange('')}
          />
        </div>
        <div className='w-[180px] h-8'></div>
      </div>
      <div className='relative flex flex-1 overflow-y-auto'>
        {!searchKeywords && <div className='w-[200px] h-full p-4'>
          <Sidebar current={currCategory as AppCategories} onClick={(category) => { setCurrCategory(category) }} onCreateFromBlank={onCreateFromBlank} />
        </div>}
        <div className='flex-1 h-full overflow-auto shrink-0 grow p-6 pt-2 border-l border-divider-burn'>
          {searchFilteredList && searchFilteredList.length > 0 && <>
            <div className='pt-4 pb-1'>
              {searchKeywords
                ? <p className='title-md-semi-bold text-text-tertiary'>{searchFilteredList.length > 1 ? t('app.newApp.foundResults', { count: searchFilteredList.length }) : t('app.newApp.foundResult', { count: searchFilteredList.length })}</p>
                : <AppCategoryLabel category={currCategory as AppCategories} className='title-md-semi-bold text-text-primary' />}
            </div>
            <div
              className={cn(
                'grid content-start shrink-0 gap-3 grid-cols-1 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6',
              )}>
              {searchFilteredList.map(app => (
                <AppCard
                  key={app.app_id}
                  app={app}
                  canCreate={hasEditPermission}
                  onCreate={() => {
                    setCurrApp(app)
                    setIsShowCreateModal(true)
                  }}
                />
              ))}
            </div>
          </>}
          {(!searchFilteredList || searchFilteredList.length === 0) && <NoTemplateFound />}
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
          onHide={() => setIsShowCreateModal(false)}
        />
      )}
    </div>
  )
}

export default React.memo(Apps)

function NoTemplateFound() {
  const { t } = useTranslation()
  return <div className='p-4 rounded-lg w-full bg-workflow-process-bg'>
    <div className='w-8 h-8 rounded-lg inline-flex items-center justify-center mb-2 shadow-lg bg-components-card-bg'>
      <RiRobot2Line className='w-5 h-5 text-text-tertiary' />
    </div>
    <p className='title-md-semi-bold text-text-primary'>{t('app.newApp.noTemplateFound')}</p>
    <p className='system-sm-regular text-text-tertiary'>{t('app.newApp.noTemplateFoundTip')}</p>
  </div>
}
