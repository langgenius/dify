import { useMemo } from 'react'
import useSWR from 'swr'
import {
  fetchAppInfo,
  fetchAppMeta,
  fetchAppParams,
  fetchConversations,
} from '@/service/share'
import type { InstalledApp } from '@/models/explore'
import type { AppData } from '@/models/share'

export const useChatWithHistory = (installedAppInfo?: InstalledApp) => {
  const isInstalledApp = useMemo(() => !!installedAppInfo, [installedAppInfo])
  const { data: appInfo } = useSWR(installedAppInfo ? null : 'appInfo', fetchAppInfo)

  const appData = useMemo(() => {
    if (isInstalledApp) {
      const { id, app } = installedAppInfo!
      return {
        app_id: id,
        site: { title: app.name, icon: app.icon, icon_background: app.icon_background, prompt_public: false, copyright: '' },
        plan: 'basic',
      } as AppData
    }

    return appInfo
  }, [isInstalledApp, installedAppInfo, appInfo])
  const { data: appParams } = useSWR(['appParams', isInstalledApp, appData?.app_id], () => fetchAppParams(isInstalledApp, appData?.app_id))
  const { data: appMeta } = useSWR(['appMeta', isInstalledApp, appData?.app_id], () => fetchAppMeta(isInstalledApp, appData?.app_id))
  const { data: appConversationData } = useSWR(['appConversationData', isInstalledApp, appData?.app_id], () => fetchConversations(isInstalledApp, appData?.app_id, undefined, undefined, 100))

  return {
    appData,
    appParams,
    appMeta,
    appConversationData,
  }
}
