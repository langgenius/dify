'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname } from '@/next/navigation'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { AppInfoView } from './app-info'
import NavLink from './nav-link'

type AppDetailNavItem = {
  name: string
  href: string
  icon: string
  selectedIcon: string
}

const isLogsNavItem = (item: AppDetailNavItem) => item.href.endsWith('/logs')
const isAnnotationsNavItem = (item: AppDetailNavItem) => item.href.endsWith('/annotations')

const renderNavDivider = (key: string, expand: boolean) => (
  <div key={key} className={cn(expand ? 'px-3 py-0.5' : 'px-1 py-0.5')}>
    <Separator
      orientation="horizontal"
      variant={expand ? 'gradient' : 'solid'}
      className={cn('my-0', expand ? 'from-divider-subtle' : 'bg-divider-subtle')}
    />
  </div>
)

type AppDetailSectionProps = {
  expand?: boolean
}

const AppDetailSection = ({ expand = true }: AppDetailSectionProps) => {
  const { t } = useTranslation(['common', 'navigation'])
  const pathname = usePathname()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const appDetail = useStore((state) => state.appDetail)

  const navigation = useMemo<AppDetailNavItem[]>(() => {
    if (!appDetail) return []

    const appId = appDetail.id
    const isWorkflowApp =
      appDetail.mode === AppModeEnum.WORKFLOW || appDetail.mode === AppModeEnum.ADVANCED_CHAT
    const supportsAnnotations =
      appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.COMPLETION
    const supportsResourceAccess = appDetail.mode !== AppModeEnum.AGENT
    const appACLCapabilities = getAppACLCapabilities(appDetail.permission_keys, {
      currentUserId,
      resourceMaintainer: appDetail.maintainer,
      workspacePermissionKeys,
      isRbacEnabled,
    })

    return [
      ...(appACLCapabilities.canAccessLayout
        ? [
            {
              name: t(($) => $['appMenus.promptEng'], { ns: 'common' }),
              href: `/app/${appId}/${isWorkflowApp ? 'workflow' : 'configuration'}`,
              icon: 'i-ri-terminal-window-line',
              selectedIcon: 'i-ri-terminal-window-fill',
            },
          ]
        : []),
      ...(appACLCapabilities.canViewAccessPoint
        ? [
            {
              name: t(($) => $['appMenus.accessPoint'], { ns: 'common' }),
              href: `/app/${appId}/access-point`,
              icon: 'i-custom-vender-agent-v2-access-point',
              selectedIcon: 'i-custom-vender-agent-v2-access-point',
            },
          ]
        : []),
      ...(isWorkflowApp && appACLCapabilities.canDeploy
        ? [
            {
              name: t(($) => $['appMenus.deploy'], { ns: 'common' }),
              href: `/app/${appId}/deploy`,
              icon: 'i-ri-instance-line',
              selectedIcon: 'i-ri-instance-fill',
            },
          ]
        : []),
      ...(appACLCapabilities.canAccessLogAndAnnotation
        ? [
            {
              name: t(($) => $['appMenus.logs'], { ns: 'common' }),
              href: `/app/${appId}/logs`,
              icon: 'i-ri-file-list-3-line',
              selectedIcon: 'i-ri-file-list-3-fill',
            },
          ]
        : []),
      ...(appACLCapabilities.canAccessLogAndAnnotation && supportsAnnotations
        ? [
            {
              name: t(($) => $['appMenus.annotations'], { ns: 'common' }),
              href: `/app/${appId}/annotations`,
              icon: 'i-custom-vender-line-general-annotations size-4',
              selectedIcon: 'i-custom-vender-line-general-annotations size-4',
            },
          ]
        : []),
      ...(appACLCapabilities.canMonitor
        ? [
            {
              name: t(($) => $['appMenus.overview'], { ns: 'common' }),
              href: `/app/${appId}/overview`,
              icon: 'i-ri-dashboard-2-line',
              selectedIcon: 'i-ri-dashboard-2-fill',
            },
          ]
        : []),
      ...(supportsResourceAccess && appACLCapabilities.canAccessConfig
        ? [
            {
              name: t(($) => $['settings.resourceAccess'], { ns: 'navigation' }),
              href: `/app/${appId}/access-config`,
              icon: 'i-ri-lock-2-line',
              selectedIcon: 'i-ri-lock-2-fill',
            },
          ]
        : []),
    ]
  }, [appDetail, t, currentUserId, workspacePermissionKeys, isRbacEnabled])

  if (!appDetail) return null

  const hasLogsNavigation = navigation.some(isLogsNavItem)
  const hasAnnotationsNavigation = navigation.some(isAnnotationsNavItem)

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', expand ? 'px-2 pb-2' : 'pb-2')}>
      {!expand && (
        <div className="flex w-full shrink-0 justify-center px-3.5 pt-0.5 pb-0.75">
          <Separator
            decorative
            orientation="horizontal"
            variant="solid"
            className="my-0 w-6.75 bg-divider-subtle"
          />
        </div>
      )}
      <div className={cn('px-1 py-2', expand && '-mx-2')}>
        <AppInfoView key={appDetail?.id} expand={expand} />
      </div>
      <nav className={cn('flex flex-col gap-y-0.5 py-1', expand ? 'px-1' : 'px-3')}>
        {navigation.map((item) => {
          const shouldRenderDividerBefore =
            isLogsNavItem(item) || (!hasLogsNavigation && isAnnotationsNavItem(item))
          const shouldRenderDividerAfter = hasAnnotationsNavigation
            ? isAnnotationsNavItem(item)
            : isLogsNavItem(item)

          return (
            <Fragment key={item.href}>
              {shouldRenderDividerBefore && renderNavDivider(`${item.href}-before`, expand)}
              <NavLink
                mode={expand ? 'expand' : 'collapse'}
                iconMap={{ selected: item.selectedIcon, normal: item.icon }}
                name={item.name}
                href={item.href}
                pathname={pathname}
              />
              {shouldRenderDividerAfter && renderNavDivider(`${item.href}-after`, expand)}
            </Fragment>
          )
        })}
      </nav>
    </div>
  )
}

export default AppDetailSection
