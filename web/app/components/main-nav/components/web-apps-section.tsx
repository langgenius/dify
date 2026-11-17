'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { usePathname } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import MainNavLink from './nav-link'

const WebAppsSection = () => {
  const { t } = useTranslation(['navigation'])
  const pathname = usePathname()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  if (!hasPermission(workspacePermissionKeys, 'app_library.access')) return null

  return (
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
  )
}

export default WebAppsSection
