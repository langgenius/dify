'use client'

import type { MainNavItem, MainNavProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import EnvNav from '@/app/components/header/env-nav'
import {
  isCurrentWorkspaceDatasetOperatorAtom,
  isCurrentWorkspaceEditorAtom,
  langGeniusVersionInfoAtom,
} from '@/context/app-context-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import dynamic from '@/next/dynamic'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import AccountSection from './components/account-section'
import HelpMenu from './components/help-menu'
import MainNavLink from './components/nav-link'
import { MainNavSearchButton } from './components/search-button'
import { WorkspaceCard } from './components/workspace-card'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from './routes'

const WebAppsSection = dynamic(() => import('./components/web-apps-section'), { ssr: false })

export function MainNav({
  className,
}: MainNavProps) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const isCurrentWorkspaceEditor = useAtomValue(isCurrentWorkspaceEditorAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const agentV2Enabled = isAgentV2Enabled()
  const showEnvTag = langGeniusVersionInfo.current_env === 'TESTING' || langGeniusVersionInfo.current_env === 'DEVELOPMENT'
  const canUseAppDeploy = isCurrentWorkspaceEditor && systemFeatures.enable_app_deploy

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
        'relative flex h-full w-62 shrink-0 flex-col overflow-hidden bg-background-body p-1 transition-all',
        className,
      )}
    >
      <div className="flex min-h-0 w-60 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between pt-3 pr-2 pb-2 pl-4">
          {renderLogo()}
          <MainNavSearchButton />
        </div>
        <div className="p-2">
          <WorkspaceCard />
        </div>
        <nav className="isolate flex flex-col gap-px p-2">
          {navItems.map(item => (
            <MainNavLink key={item.href} item={item} pathname={pathname}>
              {item.href === '/roster' && (
                <Badge
                  size="xs"
                  variant="dimm"
                  text={t('menus.status', { ns: 'common' })}
                  className="ml-auto shrink-0"
                />
              )}
            </MainNavLink>
          ))}
        </nav>
        {!isCurrentWorkspaceDatasetOperator && <WebAppsSection />}
        {showEnvTag && (
          <div className="relative z-30 mt-auto shrink-0 px-3 pb-2">
            <EnvNav />
          </div>
        )}
      </div>
      <div className="flex w-60 items-center justify-between bg-gradient-to-b from-background-body-transparent to-background-body to-50% py-3 pr-1 pl-3 backdrop-blur-[2px]">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <AccountSection />
        </div>
        <div className="flex shrink-0 items-center justify-center rounded-full p-1">
          <HelpMenu />
        </div>
      </div>
    </aside>
  )
}
