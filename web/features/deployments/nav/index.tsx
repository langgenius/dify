'use client'

import type { AppInstance, AppInstanceBasicInfo } from '@dify/contracts/enterprise/types.gen'
import type { NavItem } from '@/app/components/header/nav/nav-selector'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Nav from '@/app/components/header/nav'
import { useParams, useRouter, useSelectedLayoutSegment } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { toAppMode } from '../app-mode'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../data'

function navItemFromListApp(app: AppInstance): NavItem[] {
  if (!app.id || !app.name)
    return []

  return [{
    id: app.id,
    name: app.name,
    link: `/deployments/${app.id}/overview`,
    icon_type: 'emoji',
    icon: app.icon ?? '',
    icon_background: app.iconBackground ?? null,
    icon_url: null,
    mode: toAppMode(app.mode),
  }]
}

function navItemFromOverview(instance?: AppInstanceBasicInfo): NavItem | undefined {
  if (!instance?.id)
    return undefined

  const name = instance.name ?? instance.id

  return {
    id: instance.id,
    name,
    link: `/deployments/${instance.id}/overview`,
    icon_type: 'emoji',
    icon: instance.icon ?? '',
    icon_background: instance.iconBackground ?? null,
    icon_url: null,
    mode: toAppMode(instance.mode),
  }
}

export function DeploymentsNav() {
  const { t } = useTranslation()
  const router = useRouter()
  const selectedSegment = useSelectedLayoutSegment()
  const isActive = selectedSegment === 'deployments'
  const params = useParams<{ appInstanceId?: string }>()
  const appInstanceId = params?.appInstanceId
  const hasAppInstanceId = Boolean(appInstanceId)

  const { data: currentInstance } = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.queryOptions({
    input: { params: { appInstanceId: appInstanceId ?? '' } },
    enabled: isActive && hasAppInstanceId,
    select: data => data.overview?.appInstance,
  }))

  const listQuery = useInfiniteQuery({
    ...consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
      input: pageParam => ({
        query: {
          pageNumber: Number(pageParam),
          resultsPerPage: SOURCE_APPS_PAGE_SIZE,
        },
      }),
      getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
    enabled: isActive,
  })
  const appNavItems = listQuery.data?.pages.flatMap(page => page.data?.flatMap(navItemFromListApp) ?? []) ?? []
  const currentNavItem = navItemFromOverview(currentInstance)

  const navigationItems: NavItem[] = isActive
    ? currentNavItem && !appNavItems.some(item => item.id === currentNavItem.id)
      ? [...appNavItems, currentNavItem]
      : appNavItems
    : []

  const curNav = appInstanceId
    ? navigationItems.find(item => item.id === appInstanceId)
    : undefined

  function handleCreate() {
    router.push('/deployments/create')
  }

  function handleLoadMore() {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage)
      void listQuery.fetchNextPage()
  }

  return (
    <Nav
      isApp={false}
      icon={<span aria-hidden className="i-ri-rocket-line size-4" />}
      activeIcon={<span aria-hidden className="i-ri-rocket-fill size-4" />}
      text={t('menus.deployments', { ns: 'common' })}
      activeSegment="deployments"
      link="/deployments"
      curNav={curNav}
      navigationItems={navigationItems}
      createText={t('deployments:list.createDeployment')}
      onCreate={handleCreate}
      onLoadMore={handleLoadMore}
      isLoadingMore={listQuery.isFetchingNextPage}
    />
  )
}
