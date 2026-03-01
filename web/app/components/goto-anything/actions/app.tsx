import type { ActionItem, AppSearchResult } from './types'
import type { App } from '@/types/app'
import { fetchAppList } from '@/service/apps'
import { getRedirectionPath } from '@/utils/app-redirection'
import { AppTypeIcon } from '../../app/type-selector'
import AppIcon from '../../base/app-icon'

const parser = (apps: App[]): AppSearchResult[] => {
  return apps.map(app => ({
    id: app.id,
    title: app.name,
    description: app.description,
    type: 'app' as const,
    path: getRedirectionPath(true, {
      id: app.id,
      mode: app.mode,
    }),
    icon: (
      <div className="relative shrink-0">
        <AppIcon
          size="large"
          iconType={app.icon_type}
          icon={app.icon}
          background={app.icon_background}
          imageUrl={app.icon_url}
        />
        <AppTypeIcon
          wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-[4px] border border-divider-regular outline outline-components-panel-on-panel-item-bg"
          className="h-3 w-3"
          type={app.mode}
        />
      </div>
    ),
    data: app,
  }))
}

export const appAction: ActionItem = {
  key: '@app',
  shortcut: '@app',
  title: 'Search Applications',
  description: 'Search and navigate to your applications',
  // action,
  search: async (_, searchTerm = '', _locale) => {
    try {
      const response = await fetchAppList({
        url: 'apps',
        params: {
          page: 1,
          name: searchTerm,
        },
      })
      const apps = response?.data || []
      return parser(apps)
    }
    catch (error) {
      console.warn('App search failed:', error)
      return []
    }
  },
}
