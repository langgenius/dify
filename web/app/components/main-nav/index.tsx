'use client'

import type { MainNavItem, MainNavProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { lazy, Suspense, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import EnvNav from '@/app/components/header/env-nav'
import StepByStepTourMount from '@/app/components/step-by-step-tour/mount'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { useCanViewSkills } from '@/features/skills/permissions'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import AccountSection from './components/account-section'
import HelpMenu from './components/help-menu'
import MainNavLink from './components/nav-link'
import { MainNavSearchButton } from './components/search-button'
import { WorkspaceCard } from './components/workspace-card'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from './routes'
import { useMainNavMode } from './storage'

const WebAppsSection = lazy(() => import('./components/web-apps-section'))

export function MainNav({ className, initialPlatform }: MainNavProps) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentEnv } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.meta.currentEnv,
  })
  const agentV2Enabled = isAgentV2Enabled()
  const canViewSkills = useCanViewSkills()
  const { data: enableSkill } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.enable_skill,
    }),
  )
  const showEnvTag = currentEnv === 'TESTING' || currentEnv === 'DEVELOPMENT'
  const helpMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [storedMainNavMode, setStoredMainNavMode] = useMainNavMode()
  const isCollapsed = storedMainNavMode === 'collapse'
  const collapseLabel =
    t(($) => $['sidebar.collapseSidebar'], { ns: 'layout' }) || 'Collapse sidebar'
  const expandLabel = t(($) => $['sidebar.expandSidebar'], { ns: 'layout' }) || 'Expand sidebar'
  const toggleLabel = isCollapsed ? expandLabel : collapseLabel

  const navItems = useMemo<MainNavItem[]>(
    () =>
      MAIN_NAV_ROUTES.filter((route) =>
        isMainNavRouteVisible(route, {
          agentV2Enabled,
          canViewSkills,
          isCurrentWorkspaceDatasetOperator,
          marketplaceEnabled: systemFeatures.enable_marketplace,
          skillEnabled: enableSkill === true,
        }),
      ).map((route) => ({
        href: route.href,
        label: 'label' in route ? route.label : t(($) => $[route.labelKey], { ns: 'common' }),
        active: route.active,
        icon: route.icon,
        activeIcon: route.activeIcon,
      })),
    [
      agentV2Enabled,
      canViewSkills,
      enableSkill,
      isCurrentWorkspaceDatasetOperator,
      systemFeatures.enable_marketplace,
      t,
    ],
  )

  const renderLogo = () => {
    const appTitle =
      systemFeatures.branding.enabled && systemFeatures.branding.application_title
        ? systemFeatures.branding.application_title
        : 'Dify'

    return (
      <Link
        href="/"
        className="flex h-8 shrink-0 items-center overflow-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        aria-label={appTitle}
      >
        {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo ? (
          <img
            src={systemFeatures.branding.workspace_logo}
            className="block h-5.5 w-auto object-contain"
            alt=""
          />
        ) : (
          <DifyLogo alt="" />
        )}
      </Link>
    )
  }

  const handleToggleCollapse = () => {
    setStoredMainNavMode(isCollapsed ? 'expand' : 'collapse')
  }

  return (
    <aside
      data-testid="main-nav"
      data-mode={isCollapsed ? 'collapse' : 'expand'}
      className={cn(
        'relative flex h-full shrink-0 flex-col overflow-hidden bg-background-body p-1 transition-all',
        isCollapsed ? 'w-16' : 'w-62',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden',
          isCollapsed ? 'w-14' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex items-center pt-3 pr-2 pb-2',
            isCollapsed ? 'justify-center pl-0' : 'justify-between pl-4',
          )}
        >
          {!isCollapsed && renderLogo()}
          <div className={cn('flex items-center gap-1', isCollapsed && 'flex-col-reverse')}>
            {!isCollapsed && <MainNavSearchButton initialPlatform={initialPlatform} />}
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton
                    aria-label={toggleLabel}
                    data-testid="main-nav-toggle"
                    size="lg"
                    onClick={handleToggleCollapse}
                    className="rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-4.5',
                        isCollapsed ? 'i-ri-layout-right-2-line' : 'i-ri-layout-left-2-line',
                      )}
                    />
                  </IconButton>
                }
              />
              <TooltipContent placement="right" className="rounded-lg p-1.5">
                <span className="px-0.5 system-xs-medium text-text-secondary">{toggleLabel}</span>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {!isCollapsed && (
          <div className="p-2">
            <WorkspaceCard />
          </div>
        )}
        <nav
          aria-label={t(($) => $['navigation.primary'], { ns: 'common' })}
          className={cn('isolate flex flex-col gap-px p-2', isCollapsed && 'items-center px-0')}
        >
          {navItems.map((item) => (
            <MainNavLink
              key={item.href}
              item={item}
              pathname={pathname}
              mode={isCollapsed ? 'collapse' : 'expand'}
            >
              {item.href === '/agents' && !isCollapsed && (
                <Badge
                  size="xs"
                  variant="dimm"
                  text={t(($) => $['menus.status'], { ns: 'common' })}
                  className="ml-auto shrink-0"
                />
              )}
            </MainNavLink>
          ))}
        </nav>
        {!isCurrentWorkspaceDatasetOperator && !isCollapsed && (
          <Suspense fallback={null}>
            <WebAppsSection />
          </Suspense>
        )}
        {showEnvTag && !isCollapsed && (
          <div className="mt-auto shrink-0 px-3 pb-2">
            <EnvNav />
          </div>
        )}
      </div>
      <div className={cn('isolate shrink-0', isCollapsed ? 'w-14' : 'w-60')}>
        <StepByStepTourMount
          recoveryAnchorRef={systemFeatures.branding.enabled ? undefined : helpMenuTriggerRef}
          className={cn(
            'relative z-1 -mb-1 ml-2.5 h-8 overflow-visible',
            isCollapsed ? 'w-12' : 'w-45.75',
          )}
        />
        <div
          className={cn(
            'flex items-center justify-between bg-linear-to-b from-background-body-transparent to-background-body to-50% py-3 backdrop-blur-[2px]',
            isCollapsed ? 'flex-col gap-2 px-1 pr-0' : 'pr-1 pl-3',
          )}
        >
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            <AccountSection compact={isCollapsed} />
          </div>
          <div className="flex shrink-0 items-center justify-center rounded-full p-1">
            <HelpMenu triggerRef={helpMenuTriggerRef} />
          </div>
        </div>
      </div>
    </aside>
  )
}
