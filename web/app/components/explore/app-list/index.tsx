'use client'

import React, { useEffect } from 'react'
import cn from 'classnames'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Toast from '../../base/toast'
import s from './style.module.css'
import ExploreContext from '@/context/explore-context'
import type { App, AppCategory } from '@/models/explore'
import Category from '@/app/components/explore/category'
import AppCard from '@/app/components/explore/app-card'
import { fetchAppDetail, fetchAppList } from '@/service/explore'
import { createApp } from '@/service/apps'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import Loading from '@/app/components/base/loading'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { type AppMode } from '@/types/app'
import { useAppContext } from '@/context/app-context'

type AppsProps = {
  pageType?: PageType
}

export enum PageType {
  EXPLORE = 'explore',
  CREATE = 'create',
}

const Apps = ({
  pageType = PageType.EXPLORE,
}: AppsProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const router = useRouter()
  const { hasEditPermission } = useContext(ExploreContext)
  const [currCategory, setCurrCategory] = React.useState<AppCategory | ''>('')
  const [allList, setAllList] = React.useState<App[]>([])
  const [isLoaded, setIsLoaded] = React.useState(false)

  const currList = (() => {
    if (currCategory === '')
      return allList
    return allList.filter(item => item.category === currCategory)
  })()

  const [categories, setCategories] = React.useState<AppCategory[]>([])
  useEffect(() => {
    (async () => {
      const { categories, recommended_apps }: any = await fetchAppList()
      const sortedRecommendedApps = [...recommended_apps]
      sortedRecommendedApps.sort((a, b) => a.position - b.position) // position from small to big
      setCategories(categories)
      setAllList(sortedRecommendedApps)
      setIsLoaded(true)
    })()
  }, [])

  const [currApp, setCurrApp] = React.useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = React.useState(false)
  const onCreate: CreateAppModalProps['onConfirm'] = async ({ name, icon, icon_background, description }) => {
    const { app_model_config: model_config } = await fetchAppDetail(currApp?.app.id as string)

    try {
      const app = await createApp({
        name,
        icon,
        icon_background,
        mode: currApp?.app.mode as AppMode,
        description,
        config: model_config,
      })
      setIsShowCreateModal(false)
      Toast.notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      router.push(`/app/${app.id}/${isCurrentWorkspaceManager ? 'configuration' : 'overview'}`)
    }
    catch (e) {
      Toast.notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
  }

  if (!isLoaded) {
    return (
      <div className='flex h-full items-center'>
        <Loading type='area' />
      </div>
    )
  }

  return (
    <div className={cn(
      'flex flex-col border-l border-gray-200',
      pageType === PageType.EXPLORE ? 'h-full' : 'h-[calc(100%-76px)]',
    )}>
      {pageType === PageType.EXPLORE && (
        <div className='shrink-0 pt-6 px-12'>
          <div className={`mb-1 ${s.textGradient} text-xl font-semibold`}>{t('explore.apps.title')}</div>
          <div className='text-gray-500 text-sm'>{t('explore.apps.description')}</div>
        </div>
      )}
      <Category
        className={cn(pageType === PageType.EXPLORE ? 'mt-6 px-12' : 'px-8 py-2')}
        list={categories}
        value={currCategory}
        onChange={setCurrCategory}
      />
      <div className={cn(
        'relative flex flex-1 pb-6 flex-col overflow-auto bg-gray-100 shrink-0 grow',
        pageType === PageType.EXPLORE ? 'mt-6' : 'mt-0 pt-2',
      )}>
        <nav
          className={cn(
            s.appList,
            'grid content-start shrink-0',
            pageType === PageType.EXPLORE ? 'gap-4 px-6 sm:px-12' : 'gap-3 px-8',
          )}>
          {currList.map(app => (
            <AppCard
              key={app.app_id}
              isExplore={pageType === PageType.EXPLORE}
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
          appName={currApp?.app.name || ''}
          show={isShowCreateModal}
          onConfirm={onCreate}
          onHide={() => setIsShowCreateModal(false)}
        />
      )}
    </div>
  )
}

export default React.memo(Apps)
