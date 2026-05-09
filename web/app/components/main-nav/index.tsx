'use client'

import type { MainNavItem, MainNavProps } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import EnvNav from '@/app/components/header/env-nav'
import { useAppContext } from '@/context/app-context'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import AccountSection from './components/account-section'
import HelpMenu from './components/help-menu'
import MainNavLink from './components/nav-link'
import MainNavSearchButton from './components/search-button'
import WebAppsSection from './components/web-apps-section'
import WorkspaceCard from './components/workspace-card'

const MainNav = ({
  className,
}: MainNavProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { langGeniusVersionInfo, isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceEditor } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const showEnvTag = langGeniusVersionInfo.current_env === 'TESTING' || langGeniusVersionInfo.current_env === 'DEVELOPMENT'
  const navItems = useMemo<MainNavItem[]>(() => [
    ...(!isCurrentWorkspaceDatasetOperator
      ? [
          {
            href: '/explore/apps',
            label: t('mainNav.home', { ns: 'common' }),
            active: (path: string) => path.startsWith('/explore'),
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
            href: '/tools?section=provider',
            label: t('mainNav.integrations', { ns: 'common' }),
            active: (path: string) => path.startsWith('/tools'),
            icon: 'i-custom-vender-main-nav-integrations',
            activeIcon: 'i-custom-vender-main-nav-integrations-active',
          },
        ]
      : []),
    {
      href: '/plugins',
      label: t('mainNav.marketplace', { ns: 'common' }),
      active: path => path.startsWith('/plugins'),
      icon: 'i-custom-vender-main-nav-marketplace',
      activeIcon: 'i-custom-vender-main-nav-marketplace-active',
    },
  ], [isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceEditor, t])

  const renderLogo = () => (
    <h1 className="min-w-0">
      <Link href={isCurrentWorkspaceDatasetOperator ? '/datasets' : '/apps'} className="flex h-8 shrink-0 items-center overflow-hidden px-2 indent-[-9999px] whitespace-nowrap">
        {systemFeatures.branding.enabled && systemFeatures.branding.application_title ? systemFeatures.branding.application_title : 'Dify'}
        {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
          ? (
              <img
                src={systemFeatures.branding.workspace_logo}
                className="block h-[22px] w-auto object-contain"
                alt="logo"
              />
            )
          : <DifyLogo />}
      </Link>
    </h1>
  )

  return (
    <aside className={cn('flex h-full w-[240px] shrink-0 flex-col bg-background-body', className)}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2 pt-4 pb-2">
          {renderLogo()}
          <MainNavSearchButton />
        </div>
        <div className="p-2">
          <WorkspaceCard />
        </div>
        <nav className="space-y-1 p-2">
          {navItems.map(item => (
            <MainNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        {!isCurrentWorkspaceDatasetOperator && <WebAppsSection />}
        {showEnvTag && (
          <div className="relative z-30 px-3 pb-2">
            <EnvNav />
          </div>
        )}
      </div>
      <div className="flex w-[240px] items-center justify-between bg-gradient-to-b from-background-body-transparent to-background-body to-50% py-3 pr-1 pl-3 backdrop-blur-[2px]">
        <div className="flex min-w-0 items-center gap-1">
          <AccountSection />
        </div>
        <HelpMenu />
      </div>
    </aside>
  )
}

export default MainNav
