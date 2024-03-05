'use client'
import type { FC } from 'react'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import useSWR from 'swr'
import Toast from '../../base/toast'
import s from './style.module.css'
import ExploreContext from '@/context/explore-context'
import type { App } from '@/models/explore'
import Category from '@/app/components/explore/category'
import AppCard from '@/app/components/explore/app-card'
import { fetchAppDetail, fetchAppList } from '@/service/explore'
import { createApp } from '@/service/apps'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import Loading from '@/app/components/base/loading'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { type AppMode } from '@/types/app'
import { useAppContext } from '@/context/app-context'

const Apps: FC = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const router = useRouter()
  const { hasEditPermission } = useContext(ExploreContext)
  const allCategoriesEn = t('explore.apps.allCategories', { lng: 'en' })

  const [currCategory, setCurrCategory] = useTabSearchParams({
    defaultTab: allCategoriesEn,
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

  const currList
    = currCategory === allCategoriesEn
      ? allList
      : allList.filter(item => item.category === currCategory)

  const [currApp, setCurrApp] = React.useState<App | null>(null)
  const [isShowCreateModal, setIsShowCreateModal] = React.useState(false)
  const onCreate: CreateAppModalProps['onConfirm'] = async ({
    name,
    icon,
    icon_background,
  }) => {
    const { app_model_config: model_config } = await fetchAppDetail(
      currApp?.app.id as string,
    )

    try {
      const app = await createApp({
        name,
        icon,
        icon_background,
        mode: currApp?.app.mode as AppMode,
        config: model_config,
      })
      setIsShowCreateModal(false)
      Toast.notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      router.push(
        `/app/${app.id}/${
          isCurrentWorkspaceManager ? 'configuration' : 'overview'
        }`,
      )
    }
    catch (e) {
      Toast.notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
  }

  if (!categories) {
    return (
      <div className="flex h-full items-center">
        <Loading type="area" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col border-l border-gray-200">
      <div className="shrink-0 pt-6 px-12">
        <div className={`mb-1 ${s.textGradient} text-xl font-semibold`}>
          {t('explore.apps.title')}
        </div>
        <div className="text-gray-500 text-sm">
          {t('explore.apps.description')}
        </div>
      </div>
      <Category
        className="mt-6 px-12"
        list={categories}
        value={currCategory}
        onChange={setCurrCategory}
        allCategoriesEn={allCategoriesEn}
      />
      <div className="relative flex flex-1 mt-6 pb-6 flex-col overflow-auto bg-gray-100 shrink-0 grow">
        <nav
          className={`${s.appList} grid content-start gap-4 px-6 sm:px-12 shrink-0`}
        >
          {currList.map(app => (
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
