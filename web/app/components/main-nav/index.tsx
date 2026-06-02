'use client'

import type { MainNavItem, MainNavProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import AppDetailSection from '@/app/components/app-sidebar/app-detail-section'
import AppDetailTop from '@/app/components/app-sidebar/app-detail-top'
import DatasetDetailSection from '@/app/components/app-sidebar/dataset-detail-section'
import DatasetDetailTop from '@/app/components/app-sidebar/dataset-detail-top'
import { useStore as useAppStore } from '@/app/components/app/store'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import EnvNav from '@/app/components/header/env-nav'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useLocalStorage } from '@/hooks/use-local-storage'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import AccountSection from './components/account-section'
import HelpMenu from './components/help-menu'
import MainNavLink from './components/nav-link'
import { MainNavSearchButton } from './components/search-button'
import WebAppsSection from './components/web-apps-section'
import { WorkspaceCard } from './components/workspace-card'

const DATASET_COLLECTION_ROUTES = new Set(['create', 'create-from-pipeline', 'connect'])
const DATASET_DOCUMENT_CREATION_ROUTES = new Set(['create', 'create-from-pipeline'])
const APP_DETAIL_SIDEBAR_STORAGE_KEY = 'app-detail-collapse-or-expand'

const isDatasetDetailPathname = (pathname: string) => {
  const [section, datasetId, subSection, action] = pathname.split('/').filter(Boolean)

  if (section !== 'datasets' || !datasetId)
    return false

  if (DATASET_COLLECTION_ROUTES.has(datasetId))
    return false

  if (subSection === 'documents' && action && DATASET_DOCUMENT_CREATION_ROUTES.has(action))
    return false

  return true
}

const MainNav = ({
  className,
}: MainNavProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { langGeniusVersionInfo, isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceEditor } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const showEnvTag = langGeniusVersionInfo.current_env === 'TESTING' || langGeniusVersionInfo.current_env === 'DEVELOPMENT'
  const showAppDetailNavigation = !isCurrentWorkspaceDatasetOperator && pathname.startsWith('/app/')
  const showDatasetDetailNavigation = isDatasetDetailPathname(pathname)
  const showDetailNavigation = showAppDetailNavigation || showDatasetDetailNavigation
  const { appSidebarExpand, setAppSidebarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
    setAppSidebarExpand: state.setAppSidebarExpand,
  })))
  const [storedAppSidebarExpand, setStoredAppSidebarExpand] = useLocalStorage<string>(APP_DETAIL_SIDEBAR_STORAGE_KEY, 'expand', { raw: true })
  const appDetailNavigationMode = appSidebarExpand === 'collapse' || (!appSidebarExpand && storedAppSidebarExpand === 'collapse') ? 'collapse' : 'expand'
  const appDetailNavigationExpanded = appDetailNavigationMode === 'expand'
  const handleToggleAppDetailNavigation = useCallback(() => {
    setAppSidebarExpand(appDetailNavigationExpanded ? 'collapse' : 'expand')
  }, [appDetailNavigationExpanded, setAppSidebarExpand])

  useEffect(() => {
    if (!showAppDetailNavigation)
      return

    setStoredAppSidebarExpand(appDetailNavigationMode)
  }, [appDetailNavigationMode, setStoredAppSidebarExpand, showAppDetailNavigation])

  useHotkey('Mod+B', (e) => {
    if (!showAppDetailNavigation)
      return

    e.preventDefault()
    handleToggleAppDetailNavigation()
  }, {
    ignoreInputs: true,
  })

  const navItems = useMemo<MainNavItem[]>(() => [
    ...(!isCurrentWorkspaceDatasetOperator
      ? [
          {
            href: '/',
            label: t('mainNav.home', { ns: 'common' }),
            active: (path: string) => path === '/' || path === '/explore/apps',
            icon: 'i-custom-vender-main-nav-home',
            activeIcon: 'i-custom-vender-main-nav-home-active',
          },
          {
            href: '/apps',
            label: t('menus.apps', { ns: 'common' }),
            active: (path: string) => path.startsWith('/apps') || path.startsWith('/app/'),
            icon: 'i-custom-vender-main-nav-studio',
            activeIcon: 'i-custom-vender-main-nav-studio-active',
          },
        ]
      : []),
    ...((isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator)
      ? [
          {
            href: '/datasets',
            label: t('menus.datasets', { ns: 'common' }),
            active: (path: string) => path.startsWith('/datasets'),
            icon: 'i-custom-vender-main-nav-knowledge',
            activeIcon: 'i-custom-vender-main-nav-knowledge-active',
          },
        ]
      : []),
    ...(!isCurrentWorkspaceDatasetOperator
      ? [
          {
            href: buildIntegrationPath('provider'),
            label: t('mainNav.integrations', { ns: 'common' }),
            active: (path: string) => path.startsWith('/integrations') || path.startsWith('/tools'),
            icon: 'i-custom-vender-main-nav-integrations',
            activeIcon: 'i-custom-vender-main-nav-integrations-active',
          },
        ]
      : []),
    {
      href: '/marketplace',
      label: t('mainNav.marketplace', { ns: 'common' }),
      active: path => path.startsWith('/marketplace') || path.startsWith('/plugins'),
      icon: 'i-custom-vender-main-nav-marketplace',
      activeIcon: 'i-custom-vender-main-nav-marketplace-active',
    },
  ], [isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceEditor, t])

  const renderLogo = () => (
    <Link
      href="/"
      className="flex h-8 shrink-0 items-center overflow-hidden px-2 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      aria-label={systemFeatures.branding.enabled && systemFeatures.branding.application_title ? systemFeatures.branding.application_title : 'Dify'}
    >
      {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
        ? (
            <img
              src={systemFeatures.branding.workspace_logo}
              className="block h-5.5 w-auto object-contain"
              alt=""
            />
          )
        : <DifyLogo alt="" />}
    </Link>
  )

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden transition-all',
        showAppDetailNavigation && !appDetailNavigationExpanded ? 'w-14' : 'w-60',
        showDetailNavigation ? 'bg-components-panel-bg-blur' : 'bg-background-body',
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {showDetailNavigation
          ? showAppDetailNavigation
            ? (
                <AppDetailTop
                  expand={appDetailNavigationExpanded}
                  onToggle={handleToggleAppDetailNavigation}
                />
              )
            : <DatasetDetailTop />
          : (
              <>
                <div className="flex items-center justify-between px-2 pt-4 pb-2">
                  {renderLogo()}
                  <MainNavSearchButton />
                </div>
                <div className="p-2">
                  <WorkspaceCard />
                </div>
              </>
            )}
        {showDetailNavigation
          ? showAppDetailNavigation
            ? <AppDetailSection expand={appDetailNavigationExpanded} />
            : <DatasetDetailSection />
          : (
              <>
                <nav className="space-y-1 p-2">
                  {navItems.map(item => (
                    <MainNavLink key={item.href} item={item} pathname={pathname} />
                  ))}
                </nav>
                {!isCurrentWorkspaceDatasetOperator && <WebAppsSection />}
              </>
            )}
        {showEnvTag && (
          <div className="relative z-30 mt-auto shrink-0 px-3 pb-2">
            <EnvNav />
          </div>
        )}
      </div>
      <div className={cn(
        'flex items-center bg-gradient-to-b from-background-body-transparent to-background-body to-50% py-3 backdrop-blur-[2px]',
        showAppDetailNavigation && !appDetailNavigationExpanded
          ? 'w-14 justify-center px-2'
          : 'w-60 justify-between pr-1 pl-3',
      )}
      >
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <AccountSection />
        </div>
        {(!showAppDetailNavigation || appDetailNavigationExpanded) && <HelpMenu />}
      </div>
    </aside>
  )
}

export default MainNav
