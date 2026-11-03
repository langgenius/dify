'use client'

import { useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import MainNavLink from '@/app/components/main-nav/components/nav-link'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import AccountMenu from './account-menu'

const navigationItems = [
  {
    href: '/my-apps',
    label: 'endUser.myApps',
    icon: 'i-ri-apps-2-line',
    activeIcon: 'i-ri-apps-2-fill',
  },
  {
    href: '/connections',
    label: 'endUser.connections',
    icon: 'i-ri-plug-line',
    activeIcon: 'i-ri-plug-fill',
  },
  {
    href: '/account',
    label: 'endUser.account',
    icon: 'i-ri-user-line',
    activeIcon: 'i-ri-user-fill',
  },
] as const

export default function Sidebar() {
  const { t } = useTranslation(['app'])
  const pathname = usePathname()

  return (
    <div className="flex shrink-0 flex-col gap-4 border-b border-divider-subtle p-3 md:w-60 md:gap-0 md:border-0 md:p-0">
      <div className="flex h-8 items-center px-3 md:h-auto md:ps-4 md:pe-2 md:pt-3 md:pb-2">
        <Link
          href="/"
          className="flex h-8 shrink-0 items-center rounded-md focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <DifyLogo alt="Dify" size="medium" className="md:h-[21.335px]" />
        </Link>
      </div>
      <nav
        aria-label={t(($) => $['endUser.navigation'], { ns: 'app' })}
        className="flex gap-1 md:flex-col md:p-2"
      >
        {navigationItems.map((item) => (
          <MainNavLink
            key={item.href}
            pathname={pathname}
            item={{
              ...item,
              label: t(($) => $[item.label], { ns: 'app' }),
              active: (path) => path === item.href || path.startsWith(`${item.href}/`),
            }}
          />
        ))}
      </nav>
      <div className="md:mt-auto">
        <div className="px-2 pb-1">
          <Link
            href="/create-workspace"
            className="flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 system-md-medium text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
            <span className="min-w-0 flex-1 wrap-anywhere">
              {t(($) => $['endUser.buildYourOwnApp'], { ns: 'app' })}
            </span>
            <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0" />
          </Link>
        </div>
        <div className="flex items-center gap-2 md:px-2 md:py-3">
          <AccountMenu />
        </div>
      </div>
    </div>
  )
}
