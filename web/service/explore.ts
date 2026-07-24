import type { ChatConfig } from '@/app/components/base/chat/types'
import type { ExploreAppDetailResponse } from '@/contract/console/explore'
import type { AppMeta } from '@/models/share'
import { consoleClient } from './client'

export const fetchAppList = (language?: string) => {
  if (!language)
    return consoleClient.explore.apps({})

  return consoleClient.explore.apps({
    query: { language },
  })
}

export const fetchAppDetail = async (id: string): Promise<ExploreAppDetailResponse> => {
  const response = await consoleClient.explore.appDetail({
    params: { id },
  })
  if (!response)
    throw new Error('Recommended app not found')
  return response
}

export const fetchInstalledAppList = (appId?: string | null) => {
  if (!appId)
    return consoleClient.explore.installedApps({})

  return consoleClient.explore.installedApps({
    query: { app_id: appId },
  })
}

export const uninstallApp = (id: string) => {
  return consoleClient.explore.uninstallInstalledApp({
    params: { id },
  })
}

export const updatePinStatus = (id: string, isPinned: boolean) => {
  return consoleClient.explore.updateInstalledApp({
    params: { id },
    body: {
      is_pinned: isPinned,
    },
  })
}

export const getAppAccessModeByAppId = (appId: string) => {
  return consoleClient.explore.appAccessMode({
    query: { appId },
  })
}

export const fetchInstalledAppParams = (appId: string) => {
  return consoleClient.explore.installedAppParameters({
    params: { appId },
  }) as Promise<ChatConfig>
}

export const fetchInstalledAppMeta = (appId: string) => {
  return consoleClient.explore.installedAppMeta({
    params: { appId },
  }) as Promise<AppMeta>
}

export const fetchBanners = (language?: string) => {
  if (!language)
    return consoleClient.explore.banners({})

  return consoleClient.explore.banners({
    query: { language },
  })
}
