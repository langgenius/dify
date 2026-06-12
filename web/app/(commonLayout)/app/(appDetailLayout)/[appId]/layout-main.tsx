'use client'
import type { FC } from 'react'
import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePathname, useRouter } from '@/next/navigation'
import { fetchAppDetailDirect } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import s from './style.module.css'

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
  const { isCurrentWorkspaceEditor, isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
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
    if (!routeAppDetail || !currentWorkspace.id || isLoadingCurrentWorkspace || isLoadingAppDetail)
      return
    if (routeAppDetail.id !== appId)
      return

    // redirection
    const canIEditApp = isCurrentWorkspaceEditor
    if (!canIEditApp && (pathname.endsWith('configuration') || pathname.endsWith('workflow') || pathname.endsWith('logs') || pathname.endsWith('annotations'))) {
      router.replace(`/app/${appId}/overview`)
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
  }, [appDetail?.id, appDetailRes, appId, currentWorkspace.id, isCurrentWorkspaceEditor, isLoadingAppDetail, isLoadingCurrentWorkspace, pathname, routeAppDetail, router, setAppDetail])

  if (!appDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  return (
    <div className={cn(s.app, 'relative ml-1 flex', 'overflow-hidden')}>
      <div className="grow overflow-hidden bg-components-panel-bg">
        {children}
      </div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
