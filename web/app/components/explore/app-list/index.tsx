'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Toast from '../../base/toast'
import s from './style.module.css'
import ExploreContext from '@/context/explore-context'
import type { App } from '@/models/explore'
import Category from '@/app/components/explore/category'
import AppCard from '@/app/components/explore/app-card'
import { fetchAppDetail, fetchAppList, installApp } from '@/service/explore'
import { createApp } from '@/service/apps'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import Loading from '@/app/components/base/loading'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'

const Apps: FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { setControlUpdateInstalledApps, hasEditPermission } = useContext(ExploreContext)
  const [currCategory, setCurrCategory] = React.useState('')
  const [allList, setAllList] = React.useState<App[]>([])
  const [isLoaded, setIsLoaded] = React.useState(false)

  const currList = (() => {
    if (currCategory === '')
      return allList
    return allList.filter(item => item.category === currCategory)
  })()
  const [categories, setCategories] = React.useState([])
  useEffect(() => {
    (async () => {
      const { categories, recommended_apps }: any = await fetchAppList()
      setCategories(categories)
      setAllList(recommended_apps)
      setIsLoaded(true)
    })()
  }, [])

  const handleAddToWorkspace = async (appId: string) => {
    await installApp(appId)
    Toast.notify({
      type: 'success',
      message: t('common.api.success'),
    })
    setControlUpdateInstalledApps(Date.now())
  }

  const [currApp, setCurrApp] = React.useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = React.useState(false)
  const onCreate = async ({ name, icon, icon_background }: any) => {
    const { app_model_config: model_config } = await fetchAppDetail(currApp?.app.id as string)

    try {
      const app = await createApp({
        name,
        icon,
        icon_background,
        mode: currApp?.app.mode as any,
        config: model_config,
      })
      setIsShowCreateModal(false)
      Toast.notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      router.push(`/app/${app.id}/overview`)
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
    <div className='h-full flex flex-col border-l border-gray-200'>
      <div className='shrink-0 pt-6 px-12'>
        <div className={`mb-1 ${s.textGradient} text-xl font-semibold`}>{t('explore.apps.title')}</div>
        <div className='text-gray-500 text-sm'>{t('explore.apps.description')}</div>
      </div>
      <Category
        className='mt-6 px-12'
        list={categories}
        value={currCategory}
        onChange={setCurrCategory}
      />
      <div
        className='flex mt-6 flex-col overflow-auto bg-gray-100 shrink-0 grow'
        style={{
          maxHeight: 'calc(100vh - 243px)',
        }}
      >
        <nav
          className={`${s.appList} grid content-start grid-cols-1 gap-4 px-12 pb-10grow shrink-0`}>
          {currList.map(app => (
            <AppCard
              key={app.app_id}
              app={app}
              canCreate={hasEditPermission}
              onCreate={() => {
                setCurrApp(app)
                setIsShowCreateModal(true)
              }}
              onAddToWorkspace={handleAddToWorkspace}
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
