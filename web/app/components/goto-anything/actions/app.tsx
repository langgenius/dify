import type { ActionItem, AppSearchResult, SearchResult } from './types'
import type { App } from '@/types/app'
import { RiFileListLine, RiLayoutLine, RiLineChartLine, RiNodeTree, RiTerminalBoxLine } from '@remixicon/react'
import * as React from 'react'
import { fetchAppList } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirectionPath } from '@/utils/app-redirection'
import { AppTypeIcon } from '../../app/type-selector'
import AppIcon from '../../base/app-icon'

const WORKFLOW_MODES = new Set([AppModeEnum.WORKFLOW, AppModeEnum.ADVANCED_CHAT])

type AppSection = { id: string, label: string, path: string, icon: React.ElementType }

const getAppSections = (app: App): AppSection[] => {
  const base = `/app/${app.id}`
  if (WORKFLOW_MODES.has(app.mode)) {
    return [
      { id: 'workflow', label: 'Workflow', path: `${base}/workflow`, icon: RiNodeTree },
      { id: 'overview', label: 'Overview', path: `${base}/overview`, icon: RiLineChartLine },
      { id: 'logs', label: 'Logs', path: `${base}/logs`, icon: RiFileListLine },
    ]
  }
  return [
    { id: 'configuration', label: 'Configuration', path: `${base}/configuration`, icon: RiLayoutLine },
    { id: 'overview', label: 'Overview', path: `${base}/overview`, icon: RiLineChartLine },
    { id: 'logs', label: 'Logs', path: `${base}/logs`, icon: RiFileListLine },
    { id: 'develop', label: 'Develop', path: `${base}/develop`, icon: RiTerminalBoxLine },
  ]
}

const appIcon = (app: App) => (
  <div className="relative shrink-0">
    <AppIcon
      size="large"
      iconType={app.icon_type}
      icon={app.icon}
      background={app.icon_background}
      imageUrl={app.icon_url}
    />
    <AppTypeIcon
      wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-sm border border-divider-regular outline-solid outline-components-panel-on-panel-item-bg"
      className="h-3 w-3"
      type={app.mode}
    />
  </div>
)

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
    icon: appIcon(app),
    data: app,
  }))
}

// Generate sub-section results for matched apps when in scoped @app search
const parserWithSections = (apps: App[]): SearchResult[] => {
  const results: SearchResult[] = []
  for (const app of apps) {
    results.push({
      id: app.id,
      title: app.name,
      description: app.description,
      type: 'app' as const,
      path: getRedirectionPath(true, { id: app.id, mode: app.mode }),
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
            <section.icon className="h-4 w-4 text-text-tertiary" />
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
  search: async (query, searchTerm = '', _locale) => {
    const isScoped = query.trimStart().startsWith('@app') || query.trimStart().startsWith('@App')
    try {
      const response = await fetchAppList({
        url: 'apps',
        params: {
          page: 1,
          name: searchTerm,
        },
      })
      const apps = response?.data || []
      return isScoped ? parserWithSections(apps) : parser(apps)
    }
    catch (error) {
      console.warn('App search failed:', error)
      return []
    }
  },
}
