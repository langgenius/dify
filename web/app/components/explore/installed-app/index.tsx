'use client'
import type { AppMode } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { AppData } from '@/models/share'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import TextGenerationApp from '@/app/components/share/text-generation'
import { useWebAppStore } from '@/context/web-app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode } from '@/models/access-control'
import dynamic from '@/next/dynamic'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { consoleQuery } from '@/service/client'
import AppUnavailable from '../../base/app-unavailable'
import { toInstalledAppAccessMode, toInstalledAppMeta, toInstalledAppParameters } from './runtime'

const ChatWithHistory = dynamic(() => import('@/app/components/base/chat/chat-with-history'), {
  ssr: false,
})

const InstalledAppFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="h-full bg-background-body pt-2 pl-2">{children}</div>
)

const installedAppSurfaceClassName =
  'rounded-tr-none rounded-bl-none border-t-4 border-l-4 border-components-chat-input-border'

const InstalledTextGenerationSurface = ({ children }: { children: React.ReactNode }) => (
  <div className={`h-full overflow-hidden rounded-2xl shadow-md ${installedAppSurfaceClassName}`}>
    {children}
  </div>
)

const getInstalledAppSurface = (
  mode: AppMode,
): 'chat' | 'completion' | 'unsupported' | 'workflow' => {
  switch (mode) {
    case 'chat':
    case 'advanced-chat':
    case 'agent-chat':
      return 'chat'
    case 'completion':
      return 'completion'
    case 'workflow':
      return 'workflow'
    case 'agent':
    case 'channel':
    case 'rag-pipeline':
      return 'unsupported'
  }
}

const InstalledApp = ({ id }: { id: string }) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const webappAuthEnabled = systemFeatures.webapp_auth.enabled
  const {
    data: installedApp,
    isPending: isPendingInstalledApp,
    error: installedAppError,
  } = useQuery({
    ...consoleQuery.installedApps.byInstalledAppId.get.queryOptions({
      input: {
        params: {
          installed_app_id: id,
        },
      },
    }),
  })
  const updateAppInfo = useWebAppStore((s) => s.updateAppInfo)
  const updateWebAppAccessMode = useWebAppStore((s) => s.updateWebAppAccessMode)
  const updateAppParams = useWebAppStore((s) => s.updateAppParams)
  const updateWebAppMeta = useWebAppStore((s) => s.updateWebAppMeta)
  const updateUserCanAccessApp = useWebAppStore((s) => s.updateUserCanAccessApp)
  const {
    isPending: isPendingWebAppAccessMode,
    data: webAppAccessMode,
    error: webAppAccessModeError,
  } = useQuery({
    ...consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.queryOptions({
      input: { query: { appId: id } },
    }),
    enabled: webappAuthEnabled,
    select: toInstalledAppAccessMode,
  })
  const {
    isPending: isPendingAppParams,
    data: appParams,
    error: appParamsError,
  } = useQuery({
    ...consoleQuery.installedApps.byInstalledAppId.parameters.get.queryOptions({
      input: { params: { installed_app_id: id } },
    }),
    select: toInstalledAppParameters,
  })
  const {
    isPending: isPendingAppMeta,
    data: appMeta,
    error: appMetaError,
  } = useQuery({
    ...consoleQuery.installedApps.byInstalledAppId.meta.get.queryOptions({
      input: { params: { installed_app_id: id } },
    }),
    select: toInstalledAppMeta,
  })
  const resolvedWebAppAccessMode = webappAuthEnabled
    ? webAppAccessMode?.accessMode
    : AccessMode.PUBLIC
  const {
    data: userCanAccessApp,
    error: useCanAccessAppError,
    isPending: isPendingUserCanAccessApp,
  } = useGetUserCanAccessApp({
    appId: installedApp?.app.id,
    isInstalledApp: true,
  })

  useEffect(() => {
    if (!installedApp) {
      updateAppInfo(null)
    } else {
      const { id, app } = installedApp
      updateAppInfo({
        app_id: id,
        site: {
          title: app.name,
          description: app.description,
          icon_type: app.icon_type,
          icon: app.icon ?? undefined,
          icon_background: app.icon_background,
          icon_url: app.icon_url,
          prompt_public: false,
          copyright: '',
          show_workflow_steps: true,
          use_icon_as_answer_icon: app.use_icon_as_answer_icon,
        },
        custom_config: null,
      } satisfies AppData)
    }

    if (appParams) updateAppParams(appParams)
    if (appMeta) updateWebAppMeta(appMeta)
    if (resolvedWebAppAccessMode) updateWebAppAccessMode(resolvedWebAppAccessMode)
    updateUserCanAccessApp(Boolean(userCanAccessApp?.result))
  }, [
    installedApp,
    appMeta,
    appParams,
    updateAppInfo,
    updateAppParams,
    updateUserCanAccessApp,
    updateWebAppMeta,
    userCanAccessApp,
    resolvedWebAppAccessMode,
    updateWebAppAccessMode,
  ])

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
  if (installedAppError) {
    const isNotFound = installedAppError instanceof Response && installedAppError.status === 404
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          {isNotFound ? (
            <AppUnavailable code={404} isUnknownReason />
          ) : (
            <AppUnavailable unknownReason={installedAppError.message} />
          )}
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
    isPendingInstalledApp ||
    isPendingAppParams ||
    isPendingAppMeta ||
    (webappAuthEnabled && isPendingWebAppAccessMode) ||
    isPendingUserCanAccessApp
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
  const surface = getInstalledAppSurface(installedApp.app.mode)

  if (surface === 'unsupported') {
    return (
      <InstalledAppFrame>
        <div className="flex h-full items-center justify-center">
          <AppUnavailable unknownReason="Unsupported installed app mode." />
        </div>
      </InstalledAppFrame>
    )
  }

  return (
    <InstalledAppFrame>
      {surface === 'chat' && (
        <ChatWithHistory
          installedAppInfo={installedApp}
          className={`overflow-hidden rounded-2xl shadow-md ${installedAppSurfaceClassName}`}
        />
      )}
      {surface === 'completion' && (
        <InstalledTextGenerationSurface>
          <TextGenerationApp isInstalledApp />
        </InstalledTextGenerationSurface>
      )}
      {surface === 'workflow' && (
        <InstalledTextGenerationSurface>
          <TextGenerationApp isWorkflow isInstalledApp />
        </InstalledTextGenerationSurface>
      )}
    </InstalledAppFrame>
  )
}
export default React.memo(InstalledApp)
