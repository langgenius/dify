import type { AccessMode } from '@/models/access-control'
import type { App, AppCategory } from '@/models/explore'
import { del, get, patch } from './base'

export const fetchAppList = () => {
  return get<{
    categories: AppCategory[]
    recommended_apps: App[]
  }>('/explore/apps')
}

export const fetchAppDetail = (id: string): Promise<any> => {
  return get(`/explore/apps/${id}`)
}

export const fetchInstalledAppList = (app_id?: string | null) => {
  return get(`/installed-apps${app_id ? `?app_id=${app_id}` : ''}`)
}

export const uninstallApp = (id: string) => {
  return del(`/installed-apps/${id}`)
}

export const updatePinStatus = (id: string, isPinned: boolean) => {
  return patch(`/installed-apps/${id}`, {
    body: {
      is_pinned: isPinned,
    },
  })
}

export const getAppAccessModeByAppId = (appId: string) => {
  return get<{ accessMode: AccessMode }>(`/enterprise/webapp/app/access-mode?appId=${appId}`)
}
