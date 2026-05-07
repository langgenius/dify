'use client'

import type { NavItem } from '../nav/nav-selector'
import type { AppListQuery } from '@/contract/console/apps'
import {
  RiRobot2Fill,
  RiRobot2Line,
} from '@remixicon/react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import dynamic from '@/next/dynamic'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import Nav from '../nav'

const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), { ssr: false })
const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), { ssr: false })
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), { ssr: false })

const appNavListQuery = {
  page: 1,
  limit: 30,
  name: '',
} satisfies AppListQuery

const getAppLink = (isCurrentWorkspaceEditor: boolean, appId: string, appMode: AppModeEnum) => {
  if (!isCurrentWorkspaceEditor)
    return `/app/${appId}/overview`

  if (appMode === AppModeEnum.WORKFLOW || appMode === AppModeEnum.ADVANCED_CHAT)
    return `/app/${appId}/workflow`

  return `/app/${appId}/configuration`
}

const AppNav = () => {
  const { t } = useTranslation()
  const { appId } = useParams()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const appDetail = useAppStore(state => state.appDetail)
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const [showNewAppTemplateDialog, setShowNewAppTemplateDialog] = useState(false)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)

  const {
    data: appsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          ...appNavListQuery,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
    enabled: !!appId,
  })

  const handleLoadMore = useCallback(() => {
    if (hasNextPage)
      fetchNextPage()
  }, [fetchNextPage, hasNextPage])

  const openModal = (state: string) => {
    if (state === 'blank')
      setShowNewAppDialog(true)
    if (state === 'template')
      setShowNewAppTemplateDialog(true)
    if (state === 'dsl')
      setShowCreateFromDSLModal(true)
  }

  const navItems = useMemo<NavItem[]>(() => {
    const appItems = appsData?.pages.flatMap(appData => appData.data) ?? []

    return appItems.map(app => ({
      id: app.id,
      icon_type: app.icon_type,
      icon: app.icon,
      icon_background: app.icon_background,
      icon_url: app.icon_url,
      name: appDetail?.id === app.id ? appDetail.name : app.name,
      mode: app.mode,
      link: getAppLink(isCurrentWorkspaceEditor, app.id, app.mode),
    }))
  }, [appDetail?.id, appDetail?.name, appsData?.pages, isCurrentWorkspaceEditor])

  return (
    <>
      <Nav
        isApp
        icon={<RiRobot2Line className="h-4 w-4" />}
        activeIcon={<RiRobot2Fill className="h-4 w-4" />}
        text={t('menus.apps', { ns: 'common' })}
        activeSegment={['apps', 'app']}
        link="/apps"
        curNav={appDetail}
        navigationItems={navItems}
        createText={t('menus.newApp', { ns: 'common' })}
        onCreate={openModal}
        onLoadMore={handleLoadMore}
        isLoadingMore={isFetchingNextPage}
      />
      <CreateAppModal
        show={showNewAppDialog}
        onClose={() => setShowNewAppDialog(false)}
        onSuccess={() => refetch()}
      />
      <CreateAppTemplateDialog
        show={showNewAppTemplateDialog}
        onClose={() => setShowNewAppTemplateDialog(false)}
        onSuccess={() => refetch()}
      />
      <CreateFromDSLModal
        show={showCreateFromDSLModal}
        onClose={() => setShowCreateFromDSLModal(false)}
        onSuccess={() => refetch()}
      />
    </>
  )
}

export default AppNav
