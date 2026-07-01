'use client'
import type { AccessMode } from '@/models/access-control'
import type { AppData } from '@/models/share'
import * as React from 'react'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import TextGenerationApp from '@/app/components/share/text-generation'
import { useWebAppStore } from '@/context/web-app-context'
import dynamic from '@/next/dynamic'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { useGetInstalledAppAccessModeByAppId, useGetInstalledAppMeta, useGetInstalledAppParams, useGetInstalledApps } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import AppUnavailable from '../../base/app-unavailable'

const ChatWithHistory = dynamic(() => import('@/app/components/base/chat/chat-with-history'), { ssr: false })

const InstalledAppFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="h-full bg-background-body pt-2 pl-2">
    {children}
  </div>
)

const installedAppSurfaceClassName = 'rounded-tr-none rounded-bl-none border-t-4 border-l-4 border-components-chat-input-border'

const InstalledTextGenerationSurface = ({ children }: { children: React.ReactNode }) => (
  <div className={`h-full overflow-hidden rounded-2xl shadow-md ${installedAppSurfaceClassName}`}>
    {children}
  </div>
)

const InstalledApp = ({
  id,
}: {
  id: string
}) => {
  const { data, isPending: isPendingInstalledApps, isFetching: isFetchingInstalledApps } = useGetInstalledApps()
  const installedApp = data?.installed_apps?.find(item => item.id === id)
  const updateAppInfo = useWebAppStore(s => s.updateAppInfo)
  const updateWebAppAccessMode = useWebAppStore(s => s.updateWebAppAccessMode)
  const updateAppParams = useWebAppStore(s => s.updateAppParams)
  const updateWebAppMeta = useWebAppStore(s => s.updateWebAppMeta)
  const updateUserCanAccessApp = useWebAppStore(s => s.updateUserCanAccessApp)
  const { isPending: isPendingWebAppAccessMode, data: webAppAccessMode, error: webAppAccessModeError } = useGetInstalledAppAccessModeByAppId(installedApp?.id ?? null)
  const { isPending: isPendingAppParams, data: appParams, error: appParamsError } = useGetInstalledAppParams(installedApp?.id ?? null)
  const { isPending: isPendingAppMeta, data: appMeta, error: appMetaError } = useGetInstalledAppMeta(installedApp?.id ?? null)
  const { data: userCanAccessApp, error: useCanAccessAppError } = useGetUserCanAccessApp({ appId: installedApp?.app.id, isInstalledApp: true })

  useEffect(() => {
    if (!installedApp) {
      updateAppInfo(null)
    }
    else {
      const { id, app } = installedApp
      updateAppInfo({
        app_id: id,
        site: {
          title: app.name,
          description: app.description,
          icon_type: app.icon_type,
          icon: app.icon,
          icon_background: app.icon_background,
          icon_url: app.icon_url,
          prompt_public: false,
          copyright: '',
          show_workflow_steps: true,
          use_icon_as_answer_icon: app.use_icon_as_answer_icon,
        },
        plan: 'basic',
        custom_config: null,
      } as AppData)
    }

    if (appParams)
      updateAppParams(appParams)
    if (appMeta)
      updateWebAppMeta(appMeta)
    if (webAppAccessMode)
      updateWebAppAccessMode((webAppAccessMode as { accessMode: AccessMode }).accessMode)
    updateUserCanAccessApp(Boolean(userCanAccessApp && (userCanAccessApp as { result: boolean })?.result))
  }, [installedApp, appMeta, appParams, updateAppInfo, updateAppParams, updateUserCanAccessApp, updateWebAppMeta, userCanAccessApp, webAppAccessMode, updateWebAppAccessMode])

  if (appParamsError) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <AppUnavailable unknownReason={appParamsError.message} />
        </div>
      </InstalledAppFrame>
    )
  }
  if (appMetaError) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <AppUnavailable unknownReason={appMetaError.message} />
        </div>
      </InstalledAppFrame>
    )
  }
  if (useCanAccessAppError) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <AppUnavailable unknownReason={useCanAccessAppError.message} />
        </div>
      </InstalledAppFrame>
    )
  }
  if (webAppAccessModeError) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <AppUnavailable unknownReason={webAppAccessModeError.message} />
        </div>
      </InstalledAppFrame>
    )
  }
  if (userCanAccessApp && !userCanAccessApp.result) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full flex-col items-center justify-center gap-y-2">
          <AppUnavailable className="size-auto" code={403} unknownReason="no permission." />
        </div>
      </InstalledAppFrame>
    )
  }
  if (
    isPendingInstalledApps
    || (!installedApp && isFetchingInstalledApps)
    || (installedApp && (isPendingAppParams || isPendingAppMeta || isPendingWebAppAccessMode))
  ) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <Loading />
        </div>
      </InstalledAppFrame>
    )
  }
  if (!installedApp) {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <AppUnavailable code={404} isUnknownReason />
        </div>
      </InstalledAppFrame>
    )
  }
  return (
    <InstalledAppFrame>
      {installedApp?.app.mode !== AppModeEnum.COMPLETION && installedApp?.app.mode !== AppModeEnum.WORKFLOW && (
        <ChatWithHistory installedAppInfo={installedApp} className={`overflow-hidden rounded-2xl shadow-md ${installedAppSurfaceClassName}`} />
      )}
      {installedApp?.app.mode === AppModeEnum.COMPLETION && (
        <InstalledTextGenerationSurface>
          <TextGenerationApp isInstalledApp installedAppInfo={installedApp} />
        </InstalledTextGenerationSurface>
      )}
      {installedApp?.app.mode === AppModeEnum.WORKFLOW && (
        <InstalledTextGenerationSurface>
          <TextGenerationApp isWorkflow isInstalledApp installedAppInfo={installedApp} />
        </InstalledTextGenerationSurface>
      )}
    </InstalledAppFrame>
  )
}
export default React.memo(InstalledApp)
