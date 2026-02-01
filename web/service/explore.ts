import type { AccessMode } from '@/models/access-control'
import type { Banner } from '@/models/app'
import type { App, AppCategory } from '@/models/explore'
import { del, get, patch } from './base'

export const fetchAppList = () => {
  return get<{
    categories: AppCategory[]
    recommended_apps: App[]
  }>('/explore/apps')
}

// eslint-disable-next-line ts/no-explicit-any
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

export const fetchBanners = (language?: string): Promise<Banner[]> => {
  const url = language ? `/explore/banners?language=${language}` : '/explore/banners'
  return get<Banner[]>(url)
}
