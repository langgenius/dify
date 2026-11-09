'use client'

import { useAtomValue } from 'jotai'
import { use } from 'react'
import { browser } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { usePathname } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import MainNavLink from './nav-link'

const WebAppsSection = () => {
  use(browser('The installed apps navigation renders in the browser.'))
  const { t } = useTranslation(['navigation'])
  const pathname = usePathname()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  if (!hasPermission(workspacePermissionKeys, 'app_library.access')) return null

  return (
    <div className="px-2 pb-2">
      <MainNavLink
        item={{
          href: '/published-apps',
          label: t(($) => $['mainNav.publishedApps'], { ns: 'navigation' }),
          active: (path) => path === '/published-apps' || isInstalledAppPath(path),
          icon: 'i-ri-apps-2-add-line',
          activeIcon: 'i-ri-apps-2-add-fill',
        }}
        pathname={pathname}
      />
    </div>
  )
}

export default WebAppsSection
