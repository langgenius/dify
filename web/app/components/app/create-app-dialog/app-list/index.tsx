'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import useSWR from 'swr'
import { useDebounceFn } from 'ahooks'
import { RiAppsFill, RiExchange2Fill, RiPassPendingFill, RiQuillPenFill, RiTerminalBoxFill, RiThumbUpFill } from '@remixicon/react'
import AppCard from '../app-card'
import Toast from '@/app/components/base/toast'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import ExploreContext from '@/context/explore-context'
import type { App, AppCategory } from '@/models/explore'
import { fetchAppDetail, fetchAppList } from '@/service/explore'
import { importApp } from '@/service/apps'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import AppTypeSelector from '@/app/components/app/type-selector'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import Loading from '@/app/components/base/loading'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { getRedirection } from '@/utils/app-redirection'
import Input from '@/app/components/base/input'

type AppsProps = {
  onSuccess?: () => void
}

export enum PageType {
  EXPLORE = 'explore',
  CREATE = 'create',
}

const Apps = ({
  onSuccess,
}: AppsProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { push } = useRouter()
  const { hasEditPermission } = useContext(ExploreContext)
  const allCategoriesEn = t('explore.apps.allCategories', { lng: 'en' })

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const [currentType, setCurrentType] = useState<string>('')
  const [currCategory, setCurrCategory] = useTabSearchParams({
    defaultTab: allCategoriesEn,
    // disableSearchParams: pageType !== PageType.EXPLORE,
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
    if (currCategory === allCategoriesEn) {
      if (!currentType)
        return allList
      else if (currentType === 'chatbot')
        return allList.filter(item => (item.app.mode === 'chat' || item.app.mode === 'advanced-chat'))
      else if (currentType === 'agent')
        return allList.filter(item => (item.app.mode === 'agent-chat'))
      else
        return allList.filter(item => (item.app.mode === 'workflow'))
    }
    else {
      if (!currentType)
        return allList.filter(item => item.category === currCategory)
      else if (currentType === 'chatbot')
        return allList.filter(item => (item.app.mode === 'chat' || item.app.mode === 'advanced-chat') && item.category === currCategory)
      else if (currentType === 'agent')
        return allList.filter(item => (item.app.mode === 'agent-chat') && item.category === currCategory)
      else
        return allList.filter(item => (item.app.mode === 'workflow') && item.category === currCategory)
    }
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
      const app = await importApp({
        data: export_data,
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
      getRedirection(isCurrentWorkspaceEditor, app, push)
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
    <div className='flex flex-col h-full'>
      <div className='flex justify-between items-center py-3 border-b border-divider-burn'>
        <div className='w-[180px] text-center'>
          <span className='title-xl-semi-bold'>{t('app.newApp.startFromTemplate')}</span>
        </div>
        <div className='flex-1 max-w-[548px] p-1.5 flex items-center rounded-xl bg-components-panel-bg-blur border border-components-panel-border'>
          <AppTypeSelector className='w-[117px]' value={currentType} onChange={setCurrentType} />
          <div className='h-[14px]'>
            <Divider type='vertical' />
          </div>
          <Input
            showClearIcon
            wrapperClassName='w-full'
            className='bg-transparent hover:bg-transparent focus:bg-transparent hover:border-transparent focus:border-transparent focus:shadow-none'
            placeholder='Search all templates...'
            value={keywords}
            onChange={e => handleKeywordsChange(e.target.value)}
            onClear={() => handleKeywordsChange('')}
          />
        </div>
        <div className='w-[180px] h-8'></div>
      </div>
      <div className='relative flex flex-1'>
        <div className='w-[200px] h-full p-4'>
          <ul>
            {
              categories.map((category) => {
                return <li key={category} className='p-1 rounded-lg flex items-center gap-2 group cursor-pointer
                focus:bg-state-base-active active:bg-state-base-active hover:bg-state-base-hover
                '>
                  <div className='p-1 rounded-md border border-divider-regular bg-components-icon-bg-blue-solid'>
                    <AppCategoryIcon category={category} />
                  </div>
                  <span className='system-sm-semibold
                  group-focus:text-components-menu-item-text-active
                  group-active:text-components-menu-item-text-active
                  group-hover:text-components-menu-item-text-hover'>{category}</span>
                </li>
              })
            }
          </ul>
        </div>
        <div className={cn(
          'flex-1 h-full overflow-auto shrink-0 grow p-6 pt-2 border-l border-divider-burn',
        )}>
          <div
            className={cn(
              'grid content-start shrink-0 gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6',
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

type AppCategoryIconProps = {
  category: AppCategory
}
function AppCategoryIcon({ category }: AppCategoryIconProps) {
  if (category === 'Agent')
    return <RiAppsFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === 'Assistant')
    return <RiAppsFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === 'HR')
    return <RiPassPendingFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === 'Programming')
    return <RiTerminalBoxFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === 'Recommended')
    return <RiThumbUpFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === 'Writing')
    return <RiQuillPenFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  if (category === '工作流')
    return <RiExchange2Fill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
  return <RiAppsFill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
}
