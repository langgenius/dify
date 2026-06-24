'use client'

import type {
  AppInstance,
  GetAppInstanceResponse,
} from '@dify/contracts/enterprise/types.gen'
import type { NavItem } from '@/app/components/header/nav/nav-selector'
import { keepPreviousData, skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import {
  deploymentRouteAppInstanceIdAtom,
  deploymentsRouteActiveAtom,
} from '../route-state'
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

const deploymentsNavCurrentInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const isActive = get(deploymentsRouteActiveAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: appInstanceId
      ? {
          params: {
            appInstanceId,
          },
        }
      : skipToken,
    enabled: isActive && Boolean(appInstanceId),
    select: (data: GetAppInstanceResponse) => data.appInstance,
  })
})

export const deploymentsNavListQueryAtom = atomWithInfiniteQuery((get) => {
  const isActive = get(deploymentsRouteActiveAtom)

  return consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
    input: pageParam => ({
      query: {
        pageNumber: Number(pageParam),
        resultsPerPage: SOURCE_APPS_PAGE_SIZE,
      },
    }),
    getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    enabled: isActive,
  })
})

export const deploymentsNavItemsAtom = atom((get): NavItem[] => {
  if (!get(deploymentsRouteActiveAtom))
    return []

  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const currentInstance = get(deploymentsNavCurrentInstanceQueryAtom).data
  const appNavItems = get(deploymentsNavListQueryAtom).data?.pages.flatMap(page =>
    page.appInstances.map(navItemFromListApp),
  ) ?? []
  const currentNavItem = navItemFromOverview(currentInstance, appInstanceId)

  return currentNavItem && !appNavItems.some(item => item.id === currentNavItem.id)
    ? [...appNavItems, currentNavItem]
    : appNavItems
})

export const deploymentsNavCurrentItemAtom = atom((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  if (!appInstanceId)
    return undefined

  return get(deploymentsNavItemsAtom).find(item => item.id === appInstanceId)
})
