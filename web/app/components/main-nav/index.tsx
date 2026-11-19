'use client'

import type { ReactNode, Ref } from 'react'
import type { MainNavItem, MainNavProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { lazy, Suspense, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import EnvNav from '@/app/components/header/env-nav'
import StepByStepTourMount from '@/app/components/step-by-step-tour/mount'
import {
  isCurrentWorkspaceDatasetOperatorAtom,
  isCurrentWorkspaceManagerAtom,
} from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { useMarketplace } from '@/features/marketplace/client'
import { useCanViewSkills } from '@/features/skills/permissions'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import AccountSection from './components/account-section'
import ContactSupport from './components/contact-support'
import HelpMenu from './components/help-menu'
import MainNavLink from './components/nav-link'
import { MainNavSearchButton } from './components/search-button'
import { WorkspaceCard } from './components/workspace-card'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from './routes'

const WebAppsSection = lazy(() => import('./components/web-apps-section'))

export function MainNavLogo() {
  const { data: branding } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (data) => data.branding,
  })
  const appTitle =
    branding.enabled && branding.application_title ? branding.application_title : 'Dify'

  return (
    <Link
      href="/"
      className="flex h-8 shrink-0 items-center overflow-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      aria-label={appTitle}
    >
      {branding.enabled && branding.workspace_logo ? (
        <img src={branding.workspace_logo} className="block h-5.5 w-auto object-contain" alt="" />
      ) : (
        <DifyLogo alt="" />
      )}
    </Link>
  )
}

export function MainNavPanel({ headerAction }: { headerAction: ReactNode }) {
  const { t } = useTranslation(['common', 'navigation', 'contacts'])
  const pathname = usePathname()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const marketplaceEnabled = useMarketplace() !== null
  const { data: currentEnv } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.meta.currentEnv,
  })
  const agentV2Enabled = isAgentV2Enabled()
  const contactsEnabled = isContactsManagementEnabled()
  const canViewSkills = useCanViewSkills()
  const { data: enableSkill } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.enable_skill,
    }),
  )
  const showEnvTag = currentEnv === 'TESTING' || currentEnv === 'DEVELOPMENT'

  const navItems = useMemo<MainNavItem[]>(
    () =>
      MAIN_NAV_ROUTES.filter((route) =>
        isMainNavRouteVisible(route, {
          agentV2Enabled,
          canViewContacts: isCurrentWorkspaceManager,
          contactsEnabled,
          canViewSkills,
          isCurrentWorkspaceDatasetOperator,
          marketplaceEnabled,
          skillEnabled: enableSkill === true,
        }),
      ).map((route) => {
        const label =
          'label' in route
            ? route.label
            : 'ns' in route
              ? t(($) => $[route.labelKey], { ns: route.ns })
              : t(($) => $[route.labelKey], { ns: 'navigation' })

        return {
          href: route.href,
          label,
          active: route.active,
          icon: route.icon,
          activeIcon: route.activeIcon,
        }
      }),
    [
      agentV2Enabled,
      contactsEnabled,
      canViewSkills,
      enableSkill,
      isCurrentWorkspaceDatasetOperator,
      isCurrentWorkspaceManager,
      marketplaceEnabled,
      t,
    ],
  )

  return (
    <div className="flex min-h-0 w-60 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between ps-4 pe-2 pt-3 pb-2">
        <MainNavLogo />
        {headerAction}
      </div>
      <div className="p-2">
        <WorkspaceCard />
      </div>
      <nav
        aria-label={t(($) => $['navigation.primary'], { ns: 'common' })}
        className="isolate flex flex-col gap-px p-2"
      >
        {navItems.map((item) => (
          <MainNavLink key={item.href} item={item} pathname={pathname}>
            {item.href === '/agents' && (
              <Badge
                size="xs"
                variant="dimm"
                text={t(($) => $['menus.status'], { ns: 'navigation' })}
                className="ms-auto shrink-0"
              />
            )}
          </MainNavLink>
        ))}
      </nav>
      {!isCurrentWorkspaceDatasetOperator && (
        <Suspense fallback={null}>
          <WebAppsSection />
        </Suspense>
      )}
      {showEnvTag && (
        <div className="mt-auto shrink-0 px-3 pb-2">
          <EnvNav />
        </div>
      )}
    </div>
  )
}

export function MainNavFooter({
  helpMenuTriggerRef,
}: {
  helpMenuTriggerRef?: Ref<HTMLButtonElement>
}) {
  return (
    <div className="w-60">
      <ContactSupport placement="sidebar" />
      <div className="flex items-center justify-between bg-linear-to-b from-background-body-transparent to-background-body to-50% py-3 ps-3 pe-1 backdrop-blur-[2px]">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          <AccountSection />
        </div>
        <div className="flex shrink-0 items-center justify-center rounded-full p-1">
          <HelpMenu triggerRef={helpMenuTriggerRef} />
        </div>
      </div>
    </div>
  )
}

export function MainNav({ className, initialPlatform }: MainNavProps) {
  const { data: brandingEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (data) => data.branding.enabled,
  })
  const helpMenuTriggerRef = useRef<HTMLButtonElement>(null)

  return (
    <aside
      className={cn(
        'relative flex h-full w-60 shrink-0 flex-col overflow-hidden bg-background-body transition-all',
        className,
      )}
    >
      <MainNavPanel headerAction={<MainNavSearchButton initialPlatform={initialPlatform} />} />
      <div className="isolate w-60 shrink-0">
        <StepByStepTourMount
          recoveryAnchorRef={brandingEnabled ? undefined : helpMenuTriggerRef}
          className="relative z-1 ms-2.5 -mb-1 h-8 w-45.75 overflow-visible"
        />
        <MainNavFooter helpMenuTriggerRef={helpMenuTriggerRef} />
      </div>
    </aside>
  )
}
