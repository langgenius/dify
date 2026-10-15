import type { AppModeEnum } from '@/types/app'

// UI data for the end-user list, independent of Console's management app model.
export type EndUserApp = {
  id: string
  name: string
  description: string
  mode: AppModeEnum
  icon: string
  iconBackground: string
  iconUrl?: string
  starred: boolean
  connectionStatus: 'ready' | 'not-configured' | 'action-required'
  lastUsedAt: number
}

export type AppListFilter = {
  view: 'all' | 'starred'
  sort: 'last-used' | 'name'
  q: string
}

export type RemoveAppRequest = {
  app: EndUserApp
  deleteChats: boolean
}

export function selectApps(apps: readonly EndUserApp[], filter: AppListFilter, locale?: string) {
  const query = filter.q.trim().toLocaleLowerCase(locale)
  return apps
    .filter((app) => filter.view !== 'starred' || app.starred)
    .filter(
      (app) => !query || `${app.name} ${app.description}`.toLocaleLowerCase(locale).includes(query),
    )
    .sort((a, b) =>
      filter.sort === 'name'
        ? a.name.localeCompare(b.name, locale)
        : b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name, locale),
    )
}
