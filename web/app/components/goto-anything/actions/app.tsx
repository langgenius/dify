import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ActionItem, AppSearchResult, SearchQueryOptions } from './types'
import { consoleQuery } from '@/service/console'
import { getRedirectionPath } from '@/utils/app-redirection'
import { AppTypeIcon } from '../../app/type-selector'
import AppIcon from '../../base/app-icon'

function getAppPath(app: AppPartial) {
  return getRedirectionPath({
    id: app.id,
    mode: app.mode,
    permission_keys: app.permission_keys,
  })
}

const appIcon = (app: AppPartial) => (
  <div className="relative shrink-0">
    <AppIcon size="large" icon={app} />
    <AppTypeIcon
      wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-sm border border-divider-regular outline-solid outline-components-panel-on-panel-item-bg"
      className="size-3"
      type={app.mode}
    />
  </div>
)

function getAppResults(apps: AppPartial[]): AppSearchResult[] {
  return apps.map((app) => ({
    id: app.id,
    title: app.name,
    description: app.description ?? undefined,
    type: 'app' as const,
    path: getAppPath(app),
    icon: appIcon(app),
    data: app,
  }))
}

export const appAction: ActionItem = {
  key: '@app',
  shortcut: '@app',
  title: 'Search Applications',
  description: 'Search and navigate to your applications',
  source: 'remote',
}

export function appSearchQueryOptions(searchTerm: string, options: SearchQueryOptions = {}) {
  return consoleQuery.apps.get.queryOptions({
    input: {
      query: {
        page: 1,
        name: searchTerm,
      },
    },
    retry: false,
    ...options,
    select: (response) => getAppResults(response.data),
  })
}
