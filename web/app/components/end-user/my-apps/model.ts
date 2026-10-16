import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { AppIconProps } from '@/app/components/base/app-icon'

// UI data for the end-user list, independent of Console's management app model.
export type EndUserApp = {
  id: string
  name: string
  description: string
  mode: AppMode
  icon: NonNullable<AppIconProps['icon']>
  starred: boolean
  connectionStatus: 'ready' | 'not-configured' | 'action-required'
  lastUsedAt: number
}

export type AppListFilter = {
  view: 'all' | 'starred'
  sort: 'last-used' | 'name' | 'name-desc'
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
    .sort((a, b) => {
      if (filter.sort === 'name') return a.name.localeCompare(b.name, locale)
      if (filter.sort === 'name-desc') return b.name.localeCompare(a.name, locale)
      return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name, locale)
    })
}
