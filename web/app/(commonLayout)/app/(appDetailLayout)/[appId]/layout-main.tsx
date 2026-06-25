'use client'
import type { FC } from 'react'
import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePathname, useRouter } from '@/next/navigation'
import { fetchAppDetailDirect } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirectionPath } from '@/utils/app-redirection'
import { getAppACLCapabilities } from '@/utils/permission'

type IAppDetailLayoutProps = {
  children: React.ReactNode
  appId: string
}

const isNotFoundError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'status' in error
  && error.status === 404
)

const AppDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    appId, // get appId in path
  } = props
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isLoadingCurrentWorkspace, isLoadingWorkspacePermissionKeys, currentWorkspace, userProfile, workspacePermissionKeys } = useAppContext()
  const isRbacEnabled = systemFeatures.rbac_enabled
  const { appDetail, setAppDetail } = useStore(useShallow(state => ({
    appDetail: state.appDetail,
    setAppDetail: state.setAppDetail,
  })))
  const [isLoadingAppDetail, setIsLoadingAppDetail] = useState(false)
  const [appDetailRes, setAppDetailRes] = useState<App | null>(null)
  const routeAppDetail = appDetailRes ?? (appDetail?.id === appId ? appDetail : null)

  useDocumentTitle(appDetail?.name || t('menus.appDetail', { ns: 'common' }))

  useEffect(() => {
    let ignore = false

    const currentAppDetail = useStore.getState().appDetail
    if (currentAppDetail?.id === appId) {
      return () => {
        ignore = true
      }
    }

    setAppDetail()
    void Promise.resolve().then(() => {
      if (!ignore)
        setIsLoadingAppDetail(true)
    })
    fetchAppDetailDirect({ url: '/apps', id: appId }).then((res: App) => {
      if (ignore)
        return

      setAppDetailRes(res)
    }).catch((error: unknown) => {
      if (ignore)
        return

      if (isNotFoundError(error))
        router.replace('/apps')
    }).finally(() => {
      if (ignore)
        return

      setIsLoadingAppDetail(false)
    })

    return () => {
      ignore = true
    }
  }, [appId, router, setAppDetail])

  useEffect(() => {
    if (!routeAppDetail || !currentWorkspace.id || isLoadingCurrentWorkspace || isLoadingWorkspacePermissionKeys || isLoadingAppDetail)
      return
    if (routeAppDetail.id !== appId)
      return

    const appACLCapabilities = getAppACLCapabilities(routeAppDetail.permission_keys, {
      currentUserId: userProfile?.id,
      resourceMaintainer: routeAppDetail.maintainer,
      workspacePermissionKeys,
      isRbacEnabled,
    })
    const isLayoutPath = pathname.endsWith('configuration') || pathname.endsWith('workflow')
    const isLogsPath = pathname.endsWith('logs')
    const isAnnotationsPath = pathname.endsWith('annotations')
    const isOverviewPath = pathname.endsWith('overview')
    const isAccessConfigPath = pathname.endsWith('access-config')
    if (
      (isLayoutPath && !appACLCapabilities.canAccessLayout)
      || (isLogsPath && !appACLCapabilities.canAccessLogAndAnnotation)
      || (isAnnotationsPath && !appACLCapabilities.canAccessLogAndAnnotation)
      || (isOverviewPath && !appACLCapabilities.canMonitor)
      || (isAccessConfigPath && !appACLCapabilities.canAccessConfig)
    ) {
      router.replace(getRedirectionPath(routeAppDetail, {
        currentUserId: userProfile?.id,
        resourceMaintainer: routeAppDetail.maintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }))
      return
    }
    if ((routeAppDetail.mode === AppModeEnum.WORKFLOW || routeAppDetail.mode === AppModeEnum.ADVANCED_CHAT) && (pathname).endsWith('configuration')) {
      router.replace(`/app/${appId}/workflow`)
    }
    else if ((routeAppDetail.mode !== AppModeEnum.WORKFLOW && routeAppDetail.mode !== AppModeEnum.ADVANCED_CHAT) && (pathname).endsWith('workflow')) {
      router.replace(`/app/${appId}/configuration`)
      return
    }

    if (appDetailRes && appDetail?.id !== appDetailRes.id)
      setAppDetail({ ...appDetailRes, enable_sso: false })
  }, [appDetail?.id, appDetailRes, appId, currentWorkspace.id, isLoadingAppDetail, isLoadingCurrentWorkspace, isLoadingWorkspacePermissionKeys, isRbacEnabled, pathname, routeAppDetail, router, setAppDetail, userProfile?.id, workspacePermissionKeys])

  if (!appDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  const isWorkflowPage = pathname.endsWith('/workflow')

  return (
    <div className={cn(
      'relative flex h-0 grow overflow-hidden',
      !isWorkflowPage && 'pt-1 pr-1 pb-1',
    )}
    >
      <div className={cn(
        'grow overflow-hidden bg-components-panel-bg',
        !isWorkflowPage && 'rounded-lg shadow-xs shadow-shadow-shadow-3',
      )}
      >
        {children}
      </div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
