'use client'

import type {
  AppInstance,
  ListAppInstancesResponse,
} from '@dify/contracts/enterprise/types.gen'
import type { InfiniteData, QueryKey } from '@tanstack/react-query'
import type { NavItem } from '@/app/components/header/nav/nav-selector'
import { keepPreviousData } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../shared/domain/pagination'

export const deploymentsNavActiveAtom = atom(false)
export const deploymentsNavAppInstanceIdAtom = atom<string | undefined>(undefined)

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

export const deploymentsNavCurrentInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentsNavAppInstanceIdAtom)
  const isActive = get(deploymentsNavActiveAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: {
        appInstanceId: appInstanceId ?? '',
      },
    },
    enabled: isActive && Boolean(appInstanceId),
    select: data => data.appInstance,
  })
})

export const deploymentsNavListQueryAtom = atomWithInfiniteQuery<
  ListAppInstancesResponse,
  Error,
  InfiniteData<ListAppInstancesResponse>,
  QueryKey,
  number
>((get) => {
  const isActive = get(deploymentsNavActiveAtom)

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
  if (!get(deploymentsNavActiveAtom))
    return []

  const appInstanceId = get(deploymentsNavAppInstanceIdAtom)
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
  const appInstanceId = get(deploymentsNavAppInstanceIdAtom)
  if (!appInstanceId)
    return undefined

  return get(deploymentsNavItemsAtom).find(item => item.id === appInstanceId)
})
