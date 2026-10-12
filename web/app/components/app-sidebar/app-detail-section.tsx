'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { useQueries } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getAppIdFromPathname } from '@/app/components/app/app-detail-route'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { AppInfoView } from './app-info'
import AppInfoHeader from './app-info/app-info-header'
import { getAppModeLabel } from './app-info/app-mode-labels'
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
  const pathname = usePathname()
  const appId = getAppIdFromPathname(pathname)
  if (!appId) return null
  return <AppDetailContent key={appId} appId={appId} expand={expand} />
}

function AppDetailContent({ appId, expand }: { appId: string; expand: boolean }) {
  const { t } = useTranslation(['app', 'common', 'navigation'])
  const pathname = usePathname()
  const [detailQuery, featuresQuery, profileQuery] = useQueries({
    queries: [
      consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
      systemFeaturesQueryOptions(),
      userProfileQueryOptions(),
    ],
  })
  const systemFeatures = featuresQuery.data
  const currentUserId = profileQuery.data?.profile.id
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures?.rbac_enabled
  const appDetail = detailQuery.data

  const navigation = useMemo<AppDetailNavItem[]>(() => {
    if (!appDetail || !systemFeatures || !currentUserId) return []

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
  }, [appDetail, t, currentUserId, workspacePermissionKeys, isRbacEnabled, systemFeatures])

  const failedQuery = [detailQuery, featuresQuery, profileQuery].find(
    (query) => query.isError && !query.data,
  )
  const appTitle = appDetail?.name ?? t(($) => $['menus.appDetail'], { ns: 'navigation' })

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
        {appDetail && systemFeatures && currentUserId ? (
          <AppInfoView appDetail={appDetail} expand={expand} />
        ) : (
          <AppInfoHeader
            expand={expand}
            appName={appTitle}
            modeLabel={appDetail ? getAppModeLabel(appDetail.mode, t) : undefined}
            iconType={appDetail?.icon_type}
            icon={appDetail?.icon ?? undefined}
            background={appDetail?.icon_background}
            imageUrl={appDetail?.icon_url}
            operationGroups={[]}
          />
        )}
      </div>
      {failedQuery && (
        <div role="alert" className="flex flex-col gap-2 px-1 py-2">
          {expand && (
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['errorBoundary.message'], { ns: 'common' })}
            </p>
          )}
          <Button variant="secondary" onClick={() => void failedQuery.refetch()}>
            {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <nav
        aria-label={appTitle}
        className={cn('flex flex-col gap-y-0.5 py-1', expand ? 'px-1' : 'px-3')}
      >
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
