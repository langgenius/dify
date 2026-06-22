'use client'

import type { AppInstance } from '@dify/contracts/enterprise/types.gen'
import type { NavItem } from '@/app/components/header/nav/nav-selector'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Nav from '@/app/components/header/nav'
import { useParams, useRouter, useSelectedLayoutSegment } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../shared/domain/pagination'

function navItemFromListApp(app: AppInstance): NavItem {
  const id = app.id

  return {
    id,
    name: app.displayName,
    link: `/deployments/${id}/overview`,
    icon_type: 'emoji',
    icon: '🚀',
    icon_background: '#E0EAFF',
    icon_url: null,
  }
}

function navItemFromOverview(instance?: AppInstance, fallbackId?: string): NavItem | undefined {
  const id = instance?.id ?? fallbackId
  if (!id)
    return undefined

  return {
    id,
    name: instance ? instance.displayName : id,
    link: `/deployments/${id}/overview`,
    icon_type: 'emoji',
    icon: '🚀',
    icon_background: '#E0EAFF',
    icon_url: null,
  }
}

export function DeploymentsNav() {
  const { t } = useTranslation()
  const router = useRouter()
  const selectedSegment = useSelectedLayoutSegment()
  const isActive = selectedSegment === 'deployments'
  const params = useParams<{ appInstanceId?: string }>()
  const appInstanceId = params?.appInstanceId

  const { data: currentInstance } = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: {
        appInstanceId: appInstanceId ?? '',
      },
    },
    enabled: isActive && Boolean(appInstanceId),
    select: data => data.appInstance,
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
  const appNavItems = listQuery.data?.pages.flatMap(page =>
    page.appInstances.map(navItemFromListApp),
  ) ?? []
  const currentNavItem = navItemFromOverview(currentInstance, appInstanceId)

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
