'use client'

import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import type { ResourceMaintainerPermissionOptions } from '@/utils/permission'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import {
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useDocumentTitle from '@/hooks/use-document-title'
import { redirect, usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { isNotFoundError } from '@/service/http-error'
import { getRedirectionPath } from '@/utils/app-redirection'
import { getAppACLCapabilities } from '@/utils/permission'

type IAppDetailLayoutProps = {
  children: React.ReactNode
  appId: string
}

const appDetailPageTitle = (pathname: string, t: ReturnType<typeof useTranslation>['t']) => {
  if (pathname.endsWith('/workflow') || pathname.endsWith('/configuration'))
    return t(($) => $['appMenus.promptEng'], { ns: 'common' })
  if (pathname.endsWith('/access-point'))
    return t(($) => $['appMenus.accessPoint'], { ns: 'common' })
  if (pathname.endsWith('/deploy')) return t(($) => $['appMenus.deploy'], { ns: 'common' })
  if (pathname.endsWith('/evaluation')) return t(($) => $.title, { ns: 'evaluation' })
  if (pathname.endsWith('/logs')) return t(($) => $['appMenus.logs'], { ns: 'common' })
  if (pathname.endsWith('/annotations'))
    return t(($) => $['appMenus.annotations'], { ns: 'common' })
  if (pathname.endsWith('/overview')) return t(($) => $['appMenus.overview'], { ns: 'common' })
  if (pathname.endsWith('/access-config'))
    return t(($) => $['settings.resourceAccess'], { ns: 'navigation' })

  return t(($) => $['menus.appDetail'], { ns: 'navigation' })
}

const getAppDetailRedirectPath = (
  appDetail: AppDetailWithSite,
  pathname: string,
  permissionOptions: ResourceMaintainerPermissionOptions,
) => {
  if (appDetail.mode === 'agent' && pathname.endsWith('/access-point'))
    return appDetail.bound_agent_id ? `/agents/${appDetail.bound_agent_id}/access` : '/agents'

  const appACLCapabilities = getAppACLCapabilities(appDetail.permission_keys, permissionOptions)
  const isWorkflowApp = appDetail.mode === 'workflow' || appDetail.mode === 'advanced-chat'
  const isLayoutPath = pathname.endsWith('configuration') || pathname.endsWith('workflow')
  const isLogsPath = pathname.endsWith('logs')
  const isAnnotationsPath = pathname.endsWith('annotations')
  const isOverviewPath = pathname.endsWith('overview')
  const isAccessConfigPath = pathname.endsWith('access-config')
  const isAccessPointPath = pathname.endsWith('access-point')
  const isDeployPath = pathname.endsWith('deploy')
  const isEvaluationPath = pathname.endsWith('evaluation')
  if (
    (isLayoutPath && !appACLCapabilities.canAccessLayout) ||
    (isLogsPath && !appACLCapabilities.canAccessLogAndAnnotation) ||
    (isAnnotationsPath && !appACLCapabilities.canAccessLogAndAnnotation) ||
    (isOverviewPath && !appACLCapabilities.canMonitor) ||
    (isAccessConfigPath && (appDetail.mode === 'agent' || !appACLCapabilities.canAccessConfig)) ||
    (isAccessPointPath && !appACLCapabilities.canViewAccessPoint) ||
    (isEvaluationPath &&
      (appDetail.mode !== 'workflow' || !appDetail.workflow || !appACLCapabilities.canViewLayout)) ||
    (isDeployPath && (!isWorkflowApp || !appACLCapabilities.canDeploy))
  )
    return getRedirectionPath(appDetail, permissionOptions)

  return undefined
}

const AppDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    appId, // get appId in path
  } = props
  const { t } = useTranslation(['common', 'navigation', 'evaluation'])
  const pathname = usePathname()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const pageTitle = appDetailPageTitle(pathname, t)
  // Not useSuspenseQuery: a missing app has to stay a returned error so it can redirect to /apps.
  const { data: appDetail, error: appDetailError } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )
  const isPermissionContextReady =
    !!currentWorkspace.id && !isLoadingCurrentWorkspace && !isLoadingWorkspacePermissionKeys
  const redirectPath =
    appDetail && isPermissionContextReady
      ? getAppDetailRedirectPath(appDetail, pathname, {
          currentUserId,
          resourceMaintainer: appDetail.maintainer,
          workspacePermissionKeys,
          isRbacEnabled,
        })
      : undefined

  useDocumentTitle(
    `${pageTitle} · ${appDetail?.name || t(($) => $['menus.appDetail'], { ns: 'navigation' })}`,
  )

  if (appDetailError && !appDetail) {
    if (isNotFoundError(appDetailError)) redirect('/apps')
    throw appDetailError
  }
  if (redirectPath) redirect(redirectPath)

  const isWorkflowPage = pathname.endsWith('/workflow')
  const content =
    !appDetail || !isPermissionContextReady ? (
      <div className="flex min-w-0 grow items-center justify-center bg-background-body">
        <LoadingPlaceholder />
      </div>
    ) : (
      <div
        className={cn(
          'relative flex h-0 min-h-0 min-w-0 grow overflow-hidden',
          !isWorkflowPage && 'pt-1 pr-1 pb-1',
        )}
      >
        <div
          className={cn(
            'min-w-0 grow overflow-hidden bg-components-panel-bg',
            !isWorkflowPage && 'rounded-lg shadow-xs shadow-shadow-shadow-3',
          )}
        >
          {children}
        </div>
      </div>
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-body">
      {content}
    </div>
  )
}
export default React.memo(AppDetailLayout)
