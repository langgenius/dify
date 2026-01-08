'use client'
import type { FC } from 'react'
import type { AccessMode } from '@/models/access-control'
import type { AppData } from '@/models/share'
import * as React from 'react'
import { useEffect } from 'react'
import { useContext } from 'use-context-selector'
import ChatWithHistory from '@/app/components/base/chat/chat-with-history'
import Loading from '@/app/components/base/loading'
import TextGenerationApp from '@/app/components/share/text-generation'
import ExploreContext from '@/context/explore-context'
import { useWebAppStore } from '@/context/web-app-context'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { useGetInstalledAppAccessModeByAppId, useGetInstalledAppMeta, useGetInstalledAppParams } from '@/service/use-explore'
import { AppModeEnum } from '@/types/app'
import AppUnavailable from '../../base/app-unavailable'

export type IInstalledAppProps = {
  id: string
}

const InstalledApp: FC<IInstalledAppProps> = ({
  id,
}) => {
  const { installedApps, isFetchingInstalledApps } = useContext(ExploreContext)
  const updateAppInfo = useWebAppStore(s => s.updateAppInfo)
  const installedApp = installedApps.find(item => item.id === id)
  const updateWebAppAccessMode = useWebAppStore(s => s.updateWebAppAccessMode)
  const updateAppParams = useWebAppStore(s => s.updateAppParams)
  const updateWebAppMeta = useWebAppStore(s => s.updateWebAppMeta)
  const updateUserCanAccessApp = useWebAppStore(s => s.updateUserCanAccessApp)
  const { isFetching: isFetchingWebAppAccessMode, data: webAppAccessMode, error: webAppAccessModeError } = useGetInstalledAppAccessModeByAppId(installedApp?.id ?? null)
  const { isFetching: isFetchingAppParams, data: appParams, error: appParamsError } = useGetInstalledAppParams(installedApp?.id ?? null)
  const { isFetching: isFetchingAppMeta, data: appMeta, error: appMetaError } = useGetInstalledAppMeta(installedApp?.id ?? null)
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
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={appParamsError.message} />
      </div>
    )
  }
  if (appMetaError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={appMetaError.message} />
      </div>
    )
  }
  if (useCanAccessAppError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={useCanAccessAppError.message} />
      </div>
    )
  }
  if (webAppAccessModeError) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable unknownReason={webAppAccessModeError.message} />
      </div>
    )
  }
  if (userCanAccessApp && !userCanAccessApp.result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-y-2">
        <AppUnavailable className="h-auto w-auto" code={403} unknownReason="no permission." />
      </div>
    )
  }
  if (isFetchingAppParams || isFetchingAppMeta || isFetchingWebAppAccessMode || isFetchingInstalledApps) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading />
      </div>
    )
  }
  if (!installedApp) {
    return (
      <div className="flex h-full items-center justify-center">
        <AppUnavailable code={404} isUnknownReason />
      </div>
    )
  }
  return (
    <div className="h-full bg-background-default py-2 pl-0 pr-2 sm:p-2">
      {installedApp?.app.mode !== AppModeEnum.COMPLETION && installedApp?.app.mode !== AppModeEnum.WORKFLOW && (
        <ChatWithHistory installedAppInfo={installedApp} className="overflow-hidden rounded-2xl shadow-md" />
      )}
      {installedApp?.app.mode === AppModeEnum.COMPLETION && (
        <TextGenerationApp isInstalledApp installedAppInfo={installedApp} />
      )}
      {installedApp?.app.mode === AppModeEnum.WORKFLOW && (
        <TextGenerationApp isWorkflow isInstalledApp installedAppInfo={installedApp} />
      )}
    </div>
  )
}
export default React.memo(InstalledApp)
