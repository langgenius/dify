import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ActionItem, AppSearchResult, SearchResult } from './types'
import type { AppIconType, AppModeEnum as AppMode } from '@/types/app'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { getRedirectionPath } from '@/utils/app-redirection'
import { AppTypeIcon } from '../../app/type-selector'
import AppIcon from '../../base/app-icon'

const WORKFLOW_MODES = new Set([AppModeEnum.WORKFLOW, AppModeEnum.ADVANCED_CHAT])
const APP_MODES = new Set<string>(Object.values(AppModeEnum))
const APP_ICON_TYPES = new Set<string>(['emoji', 'image', 'link'])

type AppSection = { id: string; label: string; path: string; iconClassName: string }

function getAppMode(app: AppPartial): AppMode {
  return APP_MODES.has(app.mode) ? (app.mode as AppMode) : AppModeEnum.CHAT
}

function getAppIconType(app: AppPartial): AppIconType | null {
  return app.icon_type && APP_ICON_TYPES.has(app.icon_type) ? (app.icon_type as AppIconType) : null
}

function getAppPath(app: AppPartial) {
  return getRedirectionPath({
    id: app.id,
    mode: getAppMode(app),
    permission_keys: app.permission_keys,
  })
}

const getAppSections = (app: AppPartial): AppSection[] => {
  const base = `/app/${app.id}`
  if (WORKFLOW_MODES.has(getAppMode(app))) {
    return [
      {
        id: 'workflow',
        label: 'Workflow',
        path: `${base}/workflow`,
        iconClassName: 'i-ri-node-tree size-4 text-text-tertiary',
      },
      {
        id: 'overview',
        label: 'Overview',
        path: `${base}/overview`,
        iconClassName: 'i-ri-line-chart-line size-4 text-text-tertiary',
      },
      {
        id: 'logs',
        label: 'Logs',
        path: `${base}/logs`,
        iconClassName: 'i-ri-file-list-line size-4 text-text-tertiary',
      },
    ]
  }
  return [
    {
      id: 'configuration',
      label: 'Configuration',
      path: `${base}/configuration`,
      iconClassName: 'i-ri-layout-line size-4 text-text-tertiary',
    },
    {
      id: 'overview',
      label: 'Overview',
      path: `${base}/overview`,
      iconClassName: 'i-ri-line-chart-line size-4 text-text-tertiary',
    },
    {
      id: 'logs',
      label: 'Logs',
      path: `${base}/logs`,
      iconClassName: 'i-ri-file-list-line size-4 text-text-tertiary',
    },
    {
      id: 'develop',
      label: 'Develop',
      path: `${base}/develop`,
      iconClassName: 'i-ri-terminal-box-line size-4 text-text-tertiary',
    },
  ]
}

const appIcon = (app: AppPartial) => (
  <div className="relative shrink-0">
    <AppIcon
      size="large"
      iconType={getAppIconType(app)}
      icon={app.icon ?? undefined}
      background={app.icon_background}
      imageUrl={app.icon_url}
    />
    <AppTypeIcon
      wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-sm border border-divider-regular outline-solid outline-components-panel-on-panel-item-bg"
      className="size-3"
      type={getAppMode(app)}
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

// Generate sub-section results for matched apps when in scoped @app search
function getScopedAppResults(apps: AppPartial[]): SearchResult[] {
  const results: SearchResult[] = []
  for (const app of apps) {
    results.push({
      id: app.id,
      title: app.name,
      description: app.description ?? undefined,
      type: 'app' as const,
      path: getAppPath(app),
      icon: appIcon(app),
      data: app,
    })
    for (const section of getAppSections(app)) {
      results.push({
        id: `${app.id}:${section.id}`,
        title: `${app.name} / ${section.label}`,
        description: section.path,
        type: 'app' as const,
        path: section.path,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className={section.iconClassName} />
          </div>
        ),
        data: app,
      })
    }
  }
  return results
}

export const appAction: ActionItem = {
  key: '@app',
  shortcut: '@app',
  title: 'Search Applications',
  description: 'Search and navigate to your applications',
  source: 'remote',
}

export function appSearchQueryOptions(searchTerm: string, scoped: boolean) {
  return consoleQuery.apps.get.queryOptions({
    input: {
      query: {
        page: 1,
        name: searchTerm,
      },
    },
    select: (response) =>
      scoped ? getScopedAppResults(response.data) : getAppResults(response.data),
  })
}
