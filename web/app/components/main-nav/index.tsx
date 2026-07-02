'use client'

import type { MainNavItem, MainNavProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import AppDetailSection from '@/app/components/app-sidebar/app-detail-section'
import AppDetailTop from '@/app/components/app-sidebar/app-detail-top'
import DatasetDetailSection from '@/app/components/app-sidebar/dataset-detail-section'
import DatasetDetailTop from '@/app/components/app-sidebar/dataset-detail-top'
import { useStore as useAppStore } from '@/app/components/app/store'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import EnvNav from '@/app/components/header/env-nav'
import { useAppContext } from '@/context/app-context'
import { AgentDetailSection, AgentDetailTop } from '@/features/agent-v2/agent-detail/navigation'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { DeploymentDetailSection, DeploymentDetailTop } from '@/features/deployments/detail/deployment-sidebar'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import AccountSection from './components/account-section'
import HelpMenu from './components/help-menu'
import MainNavLink from './components/nav-link'
import { MainNavSearchButton } from './components/search-button'
import WebAppsSection from './components/web-apps-section'
import { WorkspaceCard } from './components/workspace-card'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from './routes'
import { useDetailSidebarMode } from './storage'

const DATASET_COLLECTION_ROUTES = new Set(['create', 'create-from-pipeline', 'connect'])
const DATASET_DOCUMENT_CREATION_ROUTES = new Set(['create', 'create-from-pipeline'])
const DEPLOYMENT_COLLECTION_ROUTES = new Set(['create'])
const secondarySidebarHelpTriggerIcon = <span aria-hidden className="i-ri-question-line size-4 shrink-0" />

function SecondarySidebarHelpMenu({
  triggerClassName,
}: {
  triggerClassName?: string
}) {
  return (
    <HelpMenu
      triggerIcon={secondarySidebarHelpTriggerIcon}
      triggerClassName={triggerClassName}
    />
  )
}

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

const isAgentDetailPathname = (pathname: string) => {
  const [section, type, agentId] = pathname.split('/').filter(Boolean)

  return section === 'roster' && type === 'agent' && !!agentId
}

const isDeploymentDetailPathname = (pathname: string) => {
  const [section, appInstanceId] = pathname.split('/').filter(Boolean)

  return section === 'deployments' && !!appInstanceId && !DEPLOYMENT_COLLECTION_ROUTES.has(appInstanceId)
}

const isSnippetDetailPathname = (pathname: string) => {
  const [section, snippetId] = pathname.split('/').filter(Boolean)

  return section === 'snippets' && !!snippetId
}

const MainNav = ({
  className,
}: MainNavProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { langGeniusVersionInfo, isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceEditor } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const agentV2Enabled = isAgentV2Enabled()
  const showEnvTag = langGeniusVersionInfo.current_env === 'TESTING' || langGeniusVersionInfo.current_env === 'DEVELOPMENT'
  const canUseAppDeploy = isCurrentWorkspaceEditor && systemFeatures.enable_app_deploy
  const showAppDetailNavigation = !isCurrentWorkspaceDatasetOperator && pathname.startsWith('/app/')
  const showDatasetDetailNavigation = isDatasetDetailPathname(pathname)
  const showAgentDetailNavigation = agentV2Enabled && !isCurrentWorkspaceDatasetOperator && isAgentDetailPathname(pathname)
  const showDeploymentDetailNavigation = canUseAppDeploy && !isCurrentWorkspaceDatasetOperator && isDeploymentDetailPathname(pathname)
  const showSnippetDetailBottomNavigation = isSnippetDetailPathname(pathname)
  const showDetailNavigation = showAppDetailNavigation || showDatasetDetailNavigation || showAgentDetailNavigation || showDeploymentDetailNavigation
  const { hasAppDetail, setAppDetail } = useAppStore(useShallow(state => ({
    hasAppDetail: !!state.appDetail,
    setAppDetail: state.setAppDetail,
  })))
  const [storedDetailSidebarExpand, setStoredDetailSidebarExpand] = useDetailSidebarMode()
  const detailNavigationMode = storedDetailSidebarExpand === 'collapse' ? 'collapse' : 'expand'
  const detailNavigationExpanded = detailNavigationMode === 'expand'
  const isCollapsedDetailNavigation = showDetailNavigation && !detailNavigationExpanded
  const [detailNavigationHoverPreviewOpen, setDetailNavigationHoverPreviewOpen] = useState(false)
  const [detailNavigationTransitionDisabled, setDetailNavigationTransitionDisabled] = useState(false)
  const closeDetailNavigationHoverPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detailNavigationTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDetailNavigationHoverPreviewOpen = isCollapsedDetailNavigation && detailNavigationHoverPreviewOpen
  const detailNavigationVisibleExpanded = detailNavigationExpanded || isDetailNavigationHoverPreviewOpen
  const bottomNavigationExpanded = showSnippetDetailBottomNavigation
    ? false
    : !showDetailNavigation || detailNavigationVisibleExpanded
  const handleToggleDetailNavigation = useCallback(() => {
    if (isDetailNavigationHoverPreviewOpen) {
      if (detailNavigationTransitionTimerRef.current)
        clearTimeout(detailNavigationTransitionTimerRef.current)

      setDetailNavigationTransitionDisabled(true)
      setDetailNavigationHoverPreviewOpen(false)
      setStoredDetailSidebarExpand('expand')
      detailNavigationTransitionTimerRef.current = setTimeout(() => {
        setDetailNavigationTransitionDisabled(false)
      }, 200)
      return
    }

    const nextMode = detailNavigationExpanded ? 'collapse' : 'expand'
    setDetailNavigationHoverPreviewOpen(false)
    setStoredDetailSidebarExpand(nextMode)
  }, [detailNavigationExpanded, isDetailNavigationHoverPreviewOpen, setStoredDetailSidebarExpand])
  const openDetailNavigationHoverPreview = useCallback(() => {
    if (!isCollapsedDetailNavigation)
      return

    if (closeDetailNavigationHoverPreviewTimerRef.current)
      clearTimeout(closeDetailNavigationHoverPreviewTimerRef.current)

    setDetailNavigationHoverPreviewOpen(true)
  }, [isCollapsedDetailNavigation])
  const closeDetailNavigationHoverPreview = useCallback(() => {
    if (closeDetailNavigationHoverPreviewTimerRef.current)
      clearTimeout(closeDetailNavigationHoverPreviewTimerRef.current)

    closeDetailNavigationHoverPreviewTimerRef.current = setTimeout(() => {
      setDetailNavigationHoverPreviewOpen(false)
    }, 120)
  }, [])

  useEffect(() => {
    return () => {
      if (closeDetailNavigationHoverPreviewTimerRef.current)
        clearTimeout(closeDetailNavigationHoverPreviewTimerRef.current)
      if (detailNavigationTransitionTimerRef.current)
        clearTimeout(detailNavigationTransitionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (pathname.startsWith('/app/') || !hasAppDetail)
      return

    setAppDetail()
  }, [hasAppDetail, pathname, setAppDetail])

  useHotkey('Mod+B', (e) => {
    if (!showDetailNavigation)
      return

    e.preventDefault()
    handleToggleDetailNavigation()
  }, {
    ignoreInputs: false,
  })

  const navItems = useMemo<MainNavItem[]>(() => MAIN_NAV_ROUTES
    .filter(route => isMainNavRouteVisible(route, {
      agentV2Enabled,
      canUseAppDeploy,
      isCurrentWorkspaceDatasetOperator,
      marketplaceEnabled: systemFeatures.enable_marketplace,
    }))
    .map(route => ({
      href: route.href,
      label: t(route.labelKey, { ns: 'common' }),
      active: route.active,
      icon: route.icon,
      activeIcon: route.activeIcon,
    })), [agentV2Enabled, canUseAppDeploy, isCurrentWorkspaceDatasetOperator, systemFeatures.enable_marketplace, t])

  const renderLogo = () => {
    const appTitle = systemFeatures.branding.enabled && systemFeatures.branding.application_title ? systemFeatures.branding.application_title : 'Dify'

    return (
      <Link
        href="/"
        className="flex h-8 shrink-0 items-center overflow-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        aria-label={appTitle}
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
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0',
        detailNavigationTransitionDisabled ? 'transition-none' : 'transition-all',
        isDetailNavigationHoverPreviewOpen ? 'overflow-visible' : 'overflow-hidden',
        showDetailNavigation
          ? detailNavigationExpanded
            ? 'w-[248px] bg-background-body p-1'
            : 'w-16 bg-background-body p-1'
          : showSnippetDetailBottomNavigation
            ? 'w-16 bg-background-body p-1'
            : 'w-62 flex-col p-1',
        'bg-background-body',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          !showDetailNavigation && !showSnippetDetailBottomNavigation && 'w-60 overflow-hidden',
          showDetailNavigation && (
            isDetailNavigationHoverPreviewOpen
              ? 'absolute top-1 bottom-1 left-1 z-40 w-60 overflow-hidden rounded-lg border border-divider-subtle bg-components-panel-bg shadow-lg'
              : 'overflow-hidden rounded-lg bg-components-panel-bg'
          ),
          showDetailNavigation && (detailNavigationVisibleExpanded ? 'w-60' : 'w-14'),
        )}
        onMouseEnter={isCollapsedDetailNavigation ? openDetailNavigationHoverPreview : undefined}
        onMouseLeave={isCollapsedDetailNavigation ? closeDetailNavigationHoverPreview : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {showDetailNavigation
            ? showAppDetailNavigation
              ? (
                  <AppDetailTop
                    expand={detailNavigationVisibleExpanded}
                    onToggle={handleToggleDetailNavigation}
                  />
                )
              : showDatasetDetailNavigation
                ? (
                    <DatasetDetailTop
                      expand={detailNavigationVisibleExpanded}
                      onToggle={handleToggleDetailNavigation}
                    />
                  )
                : showAgentDetailNavigation
                  ? (
                      <AgentDetailTop
                        expand={detailNavigationVisibleExpanded}
                        onToggle={handleToggleDetailNavigation}
                      />
                    )
                  : (
                      <DeploymentDetailTop
                        expand={detailNavigationVisibleExpanded}
                        onToggle={handleToggleDetailNavigation}
                      />
                    )
            : showSnippetDetailBottomNavigation
              ? null
              : (
                  <>
                    <div className="flex items-center justify-between pt-3 pr-2 pb-2 pl-4">
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
              ? <AppDetailSection expand={detailNavigationVisibleExpanded} />
              : showDatasetDetailNavigation
                ? <DatasetDetailSection expand={detailNavigationVisibleExpanded} />
                : showAgentDetailNavigation
                  ? <AgentDetailSection expand={detailNavigationVisibleExpanded} />
                  : <DeploymentDetailSection expand={detailNavigationVisibleExpanded} />
            : showSnippetDetailBottomNavigation
              ? null
              : (
                  <>
                    <nav className="isolate flex flex-col gap-px p-2">
                      {navItems.map(item => (
                        <MainNavLink key={item.href} item={item} pathname={pathname} />
                      ))}
                    </nav>
                    {!isCurrentWorkspaceDatasetOperator && <WebAppsSection />}
                  </>
                )}
          {showEnvTag && !showSnippetDetailBottomNavigation && detailNavigationVisibleExpanded && (
            <div className="relative z-30 mt-auto shrink-0 px-3 pb-2">
              <EnvNav />
            </div>
          )}
        </div>
        <div className={cn(
          !bottomNavigationExpanded
            ? 'flex w-full shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 pt-1 pb-3'
            : cn(
                'flex w-60 items-center justify-between py-3 pr-1 pl-3',
                showDetailNavigation
                  ? 'bg-components-panel-bg'
                  : 'bg-gradient-to-b from-background-body-transparent to-background-body to-50% backdrop-blur-[2px]',
              ),
        )}
        >
          {!bottomNavigationExpanded
            ? (
                <>
                  <SecondarySidebarHelpMenu triggerClassName="mb-2" />
                  <AccountSection compact />
                </>
              )
            : (
                <>
                  <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                    <AccountSection />
                  </div>
                  {(!showDetailNavigation || detailNavigationVisibleExpanded) && (
                    <div className="flex shrink-0 items-center justify-center rounded-full p-1">
                      {showDetailNavigation ? <SecondarySidebarHelpMenu /> : <HelpMenu />}
                    </div>
                  )}
                </>
              )}
        </div>
      </div>
    </aside>
  )
}

export default MainNav
