'use client'

import type { NavItem } from '../nav/nav-selector'
import type { AppListQuery } from '@/contract/console/apps'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import dynamic from '@/next/dynamic'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
import Nav from '../nav'

const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), { ssr: false })
const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), { ssr: false })
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), { ssr: false })

const appNavListQuery = {
  page: 1,
  limit: 30,
  name: '',
} satisfies AppListQuery

const getAppLink = (canAccessLayout: boolean, appId: string, appMode: AppModeEnum) => {
  if (!canAccessLayout)
    return `/app/${appId}/overview`

  if (appMode === AppModeEnum.WORKFLOW || appMode === AppModeEnum.ADVANCED_CHAT)
    return `/app/${appId}/workflow`

  return `/app/${appId}/configuration`
}

const AppNav = () => {
  const { t } = useTranslation()
  const { appId } = useParams()
  const appDetail = useAppStore(state => state.appDetail)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
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

  const openModal = useCallback((state: string) => {
    if (!canCreateApp)
      return

    if (state === 'blank')
      setShowNewAppDialog(true)
    if (state === 'template')
      setShowNewAppTemplateDialog(true)
    if (state === 'dsl')
      setShowCreateFromDSLModal(true)
  }, [canCreateApp])

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
      link: getAppLink(getAppACLCapabilities(app.permission_keys, {
        currentUserId,
        resourceMaintainer: app.maintainer,
        workspacePermissionKeys,
      }).canAccessLayout, app.id, app.mode),
    }))
  }, [appDetail?.id, appDetail?.name, appsData?.pages, currentUserId, workspacePermissionKeys])

  return (
    <>
      <Nav
        isApp
        icon={<span className="i-ri-robot-2-line size-4" />}
        activeIcon={<span className="i-ri-robot-2-fill size-4" />}
        text={t('menus.apps', { ns: 'common' })}
        activeSegment={['apps', 'app', 'snippets']}
        link="/apps"
        activeLink={{
          segment: 'snippets',
          text: t('tabs.snippets', { ns: 'workflow' }),
          link: '/snippets',
        }}
        curNav={appDetail}
        navigationItems={navItems}
        createText={t('menus.newApp', { ns: 'common' })}
        onCreate={openModal}
        onLoadMore={handleLoadMore}
        isLoadingMore={isFetchingNextPage}
      />
      <CreateAppModal
        show={canCreateApp && showNewAppDialog}
        onClose={() => setShowNewAppDialog(false)}
        onSuccess={() => refetch()}
      />
      <CreateAppTemplateDialog
        show={canCreateApp && showNewAppTemplateDialog}
        onClose={() => setShowNewAppTemplateDialog(false)}
        onSuccess={() => refetch()}
      />
      <CreateFromDSLModal
        show={canCreateApp && showCreateFromDSLModal}
        onClose={() => setShowCreateFromDSLModal(false)}
        onSuccess={() => refetch()}
      />
    </>
  )
}

export default AppNav
