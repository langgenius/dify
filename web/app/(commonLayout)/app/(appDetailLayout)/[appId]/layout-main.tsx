'use client'

import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect } from 'react'
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
import { usePathname, useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { getRedirectionPath } from '@/utils/app-redirection'
import { getAppACLCapabilities } from '@/utils/permission'

type IAppDetailLayoutProps = {
  children: React.ReactNode
  appId: string
}

const isNotFoundError = (error: unknown) =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 404

const appDetailPageTitle = (pathname: string, t: ReturnType<typeof useTranslation>['t']) => {
  if (pathname.endsWith('/workflow') || pathname.endsWith('/configuration'))
    return t(($) => $['appMenus.promptEng'], { ns: 'common' })
  if (pathname.endsWith('/access-point'))
    return t(($) => $['appMenus.accessPoint'], { ns: 'common' })
  if (pathname.endsWith('/deploy')) return t(($) => $['appMenus.deploy'], { ns: 'common' })
  if (pathname.endsWith('/logs')) return t(($) => $['appMenus.logs'], { ns: 'common' })
  if (pathname.endsWith('/annotations'))
    return t(($) => $['appMenus.annotations'], { ns: 'common' })
  if (pathname.endsWith('/overview')) return t(($) => $['appMenus.overview'], { ns: 'common' })
  if (pathname.endsWith('/access-config'))
    return t(($) => $['settings.resourceAccess'], { ns: 'navigation' })

  return t(($) => $['menus.appDetail'], { ns: 'navigation' })
}

const AppDetailLayout: FC<IAppDetailLayoutProps> = ({ children, appId }) => {
  const { t } = useTranslation(['common', 'navigation'])
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const { data: appDetail, error } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
      throwOnError: (error, query) => !isNotFoundError(error) && query.state.data === undefined,
    }),
  )
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
  const isReady =
    !!appDetail &&
    !!currentWorkspace.id &&
    !isLoadingCurrentWorkspace &&
    !isLoadingWorkspacePermissionKeys
  const isWorkflowPage = pathname.endsWith('/workflow')
  const isConfigurationPage = pathname.endsWith('/configuration')
  let redirectPath: string | undefined

  if (isNotFoundError(error)) {
    redirectPath = '/apps'
  } else if (isReady) {
    const permissionContext = {
      currentUserId,
      resourceMaintainer: appDetail.maintainer,
      workspacePermissionKeys,
      isRbacEnabled,
    }
    const capabilities = getAppACLCapabilities(appDetail.permission_keys, permissionContext)
    const isWorkflow =
      appDetail.mode === AppModeEnum.WORKFLOW || appDetail.mode === AppModeEnum.ADVANCED_CHAT
    const isForbidden =
      ((isConfigurationPage || isWorkflowPage) && !capabilities.canAccessLayout) ||
      ((pathname.endsWith('/logs') || pathname.endsWith('/annotations')) &&
        !capabilities.canAccessLogAndAnnotation) ||
      (pathname.endsWith('/overview') && !capabilities.canMonitor) ||
      (pathname.endsWith('/access-config') &&
        (appDetail.mode === AppModeEnum.AGENT || !capabilities.canAccessConfig)) ||
      (pathname.endsWith('/access-point') && !capabilities.canViewAccessPoint) ||
      (pathname.endsWith('/deploy') && (!isWorkflow || !capabilities.canDeploy))

    if (isForbidden) redirectPath = getRedirectionPath(appDetail, permissionContext)
    else if (isConfigurationPage && isWorkflow) redirectPath = `/app/${appId}/workflow`
    else if (isWorkflowPage && !isWorkflow) redirectPath = `/app/${appId}/configuration`
  }

  useDocumentTitle(
    `${appDetailPageTitle(pathname, t)} · ${appDetail?.name || t(($) => $['menus.appDetail'], { ns: 'navigation' })}`,
  )

  useEffect(() => {
    if (redirectPath) router.replace(redirectPath)
  }, [redirectPath, router])

  useEffect(() => {
    const subscription =
      import('@/app/components/workflow/collaboration/core/collaboration-manager')
        .then(({ collaborationManager }) =>
          collaborationManager.onAppMetaUpdate(appId, () => {
            void Promise.all([
              queryClient.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.get.queryKey({
                  input: { params: { app_id: appId } },
                }),
              }),
              queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
              queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() }),
              queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() }),
            ])
          }),
        )
        .catch(() => undefined)
    return () => {
      void subscription.then((unsubscribe) => unsubscribe?.())
    }
  }, [appId, queryClient])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-body">
      {!isReady || redirectPath ? (
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
      )}
    </div>
  )
}
export default React.memo(AppDetailLayout)
