'use client'
import type { AppInfo, AppMode } from './types'
import type { App } from '@/types/app'
import { useEffect, useMemo } from 'react'
import { useAppList } from '@/service/use-apps'
import { useDeploymentsStore } from './store'

const MAX_SOURCE_APPS = 100

function toAppInfo(app: App): AppInfo {
  return {
    id: app.id,
    name: app.name,
    mode: app.mode as AppMode,
    iconType: app.icon_type === 'image' ? 'image' : 'emoji',
    icon: app.icon,
    iconBackground: app.icon_background ?? undefined,
    iconUrl: app.icon_url,
    description: app.description,
  }
}

type UseSourceAppsOptions = {
  enabled?: boolean
}

export function useSourceApps(options: UseSourceAppsOptions = {}) {
  const { enabled = true } = options
  const seedInstancesFromApps = useDeploymentsStore(state => state.seedInstancesFromApps)

  const { data, isLoading, isFetching, isError } = useAppList({
    page: 1,
    limit: MAX_SOURCE_APPS,
  }, { enabled })

  const apps = useMemo<AppInfo[]>(() => {
    return (data?.data ?? []).map(toAppInfo)
  }, [data?.data])

  const appMap = useMemo<Map<string, AppInfo>>(() => {
    return new Map(apps.map(a => [a.id, a]))
  }, [apps])

  useEffect(() => {
    if (apps.length > 0)
      seedInstancesFromApps(apps)
  }, [apps, seedInstancesFromApps])

  return {
    apps,
    appMap,
    isLoading,
    isFetching,
    isError,
    isEmpty: !isLoading && apps.length === 0,
  }
}
