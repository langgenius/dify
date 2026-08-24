'use client'

import type { ComponentProps } from 'react'
import type { NavIcon } from './nav-link'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
import Divider from '@/app/components/base/divider'
import Annotations from '@/app/components/base/icons/src/vender/Annotations'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname } from '@/next/navigation'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { AppInfoView } from './app-info'
import { useAppInfoActions } from './app-info/use-app-info-actions'
import NavLink from './nav-link'

type AppDetailNavItem = {
  name: string
  href: string
  icon: NavIcon
  selectedIcon: NavIcon
}

const AnnotationNavIcon = ({ className, ...props }: ComponentProps<typeof Annotations>) => (
  <Annotations {...props} className={cn(className, 'size-4')} />
)

AnnotationNavIcon.displayName = 'Annotations'

const createClassNameNavIcon = (iconClassName: string) => {
  const ClassNameNavIcon = ({ className }: ComponentProps<'svg'>) => (
    <span aria-hidden className={cn(iconClassName, className)} />
  )

  ClassNameNavIcon.displayName = 'ClassNameNavIcon'

  return ClassNameNavIcon
}

const accessPointNavIcon = createClassNameNavIcon('i-custom-vender-agent-v2-access-point')
const terminalWindowLineNavIcon = createClassNameNavIcon('i-ri-terminal-window-line')
const terminalWindowFillNavIcon = createClassNameNavIcon('i-ri-terminal-window-fill')
const instanceLineNavIcon = createClassNameNavIcon('i-ri-instance-line')
const instanceFillNavIcon = createClassNameNavIcon('i-ri-instance-fill')
const fileListLineNavIcon = createClassNameNavIcon('i-ri-file-list-3-line')
const fileListFillNavIcon = createClassNameNavIcon('i-ri-file-list-3-fill')
const dashboardLineNavIcon = createClassNameNavIcon('i-ri-dashboard-2-line')
const dashboardFillNavIcon = createClassNameNavIcon('i-ri-dashboard-2-fill')
const lockLineNavIcon = createClassNameNavIcon('i-ri-lock-2-line')
const lockFillNavIcon = createClassNameNavIcon('i-ri-lock-2-fill')

const isLogsNavItem = (item: AppDetailNavItem) => item.href.endsWith('/logs')
const isAnnotationsNavItem = (item: AppDetailNavItem) => item.href.endsWith('/annotations')

const renderNavDivider = (key: string, expand: boolean) => (
  <div key={key} className={cn(expand ? 'px-3 py-0.5' : 'px-1 py-0.5')}>
    <Divider
      type="horizontal"
      bgStyle={expand ? 'gradient' : 'solid'}
      className={cn(
        'my-0 h-px',
        expand
          ? 'bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent'
          : 'bg-divider-subtle',
      )}
    />
  </div>
)

type AppDetailSectionProps = {
  expand?: boolean
}

const AppDetailSection = ({ expand = true }: AppDetailSectionProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const appDetail = useStore((state) => state.appDetail)
  const appInfoActions = useAppInfoActions({
    resetKey: appDetail?.id,
  })

  const navigation = useMemo<AppDetailNavItem[]>(() => {
    if (!appDetail) return []

    const appId = appDetail.id
    const isWorkflowApp =
      appDetail.mode === AppModeEnum.WORKFLOW || appDetail.mode === AppModeEnum.ADVANCED_CHAT
    const supportsAppDeploy = appDetail.mode === AppModeEnum.WORKFLOW
    const supportsAnnotations =
      appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.COMPLETION
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
              icon: terminalWindowLineNavIcon,
              selectedIcon: terminalWindowFillNavIcon,
            },
          ]
        : []),
      {
        name: t(($) => $['appMenus.accessPoint'], { ns: 'common' }),
        href: `/app/${appId}/access-point`,
        icon: accessPointNavIcon,
        selectedIcon: accessPointNavIcon,
      },
      ...(supportsAppDeploy && appACLCapabilities.canDeploy
        ? [
            {
              name: t(($) => $['appMenus.deploy'], { ns: 'common' }),
              href: `/app/${appId}/deploy`,
              icon: instanceLineNavIcon,
              selectedIcon: instanceFillNavIcon,
            },
          ]
        : []),
      ...(appACLCapabilities.canAccessLogAndAnnotation
        ? [
            {
              name: t(($) => $['appMenus.logs'], { ns: 'common' }),
              href: `/app/${appId}/logs`,
              icon: fileListLineNavIcon,
              selectedIcon: fileListFillNavIcon,
            },
          ]
        : []),
      ...(appACLCapabilities.canAccessLogAndAnnotation && supportsAnnotations
        ? [
            {
              name: t(($) => $['appMenus.annotations'], { ns: 'common' }),
              href: `/app/${appId}/annotations`,
              icon: AnnotationNavIcon,
              selectedIcon: AnnotationNavIcon,
            },
          ]
        : []),
      ...(appACLCapabilities.canMonitor
        ? [
            {
              name: t(($) => $['appMenus.overview'], { ns: 'common' }),
              href: `/app/${appId}/overview`,
              icon: dashboardLineNavIcon,
              selectedIcon: dashboardFillNavIcon,
            },
          ]
        : []),
      ...(appACLCapabilities.canAccessConfig
        ? [
            {
              name: t(($) => $['settings.resourceAccess'], { ns: 'common' }),
              href: `/app/${appId}/access-config`,
              icon: lockLineNavIcon,
              selectedIcon: lockFillNavIcon,
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
          <Divider
            type="horizontal"
            bgStyle="solid"
            className="my-0 h-px w-6.75 bg-divider-subtle"
          />
        </div>
      )}
      <div className="px-1 py-2">
        <AppInfoView expand={expand} actions={appInfoActions} />
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
