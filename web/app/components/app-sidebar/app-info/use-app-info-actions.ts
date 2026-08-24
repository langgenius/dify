import type {
  AppDetailWithSite,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Dispatch, SetStateAction } from 'react'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from '@/service/app-deletion'
import { copyApp, deleteApp, fetchAppDetail, updateAppInfo } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'

export type AppInfoModalType =
  | 'edit'
  | 'duplicate'
  | 'delete'
  | 'switch'
  | 'importDSL'
  | 'exportWarning'
  | null

type UseAppInfoActionsParams = {
  resetKey?: string
}

type AppInfoUiState = {
  resetKey?: string
  activeModal: AppInfoModalType
  secretEnvList: EnvironmentVariableItemResponse[]
}

const emptySecretEnvList: EnvironmentVariableItemResponse[] = []

type AppMetadata = Pick<
  App,
  | 'description'
  | 'icon'
  | 'icon_background'
  | 'icon_type'
  | 'icon_url'
  | 'max_active_requests'
  | 'name'
  | 'updated_at'
  | 'use_icon_as_answer_icon'
>

const updateCachedAppMetadata = (cachedApp: AppDetailWithSite | undefined, app: AppMetadata) => {
  if (!cachedApp) return cachedApp

  return {
    ...cachedApp,
    description: app.description,
    icon: app.icon,
    icon_background: app.icon_background,
    icon_type: app.icon_type,
    icon_url: app.icon_url,
    max_active_requests: app.max_active_requests,
    name: app.name,
    updated_at: app.updated_at,
    use_icon_as_answer_icon: app.use_icon_as_answer_icon,
  }
}

const createInitialUiState = (resetKey?: string): AppInfoUiState => ({
  resetKey,
  activeModal: null,
  secretEnvList: [],
})

const resolveStateAction = <T>(value: SetStateAction<T>, previous: T) => {
  return typeof value === 'function' ? (value as (previous: T) => T)(previous) : value
}

const getCurrentUiState = (state: AppInfoUiState, resetKey?: string) => {
  return state.resetKey === resetKey ? state : createInitialUiState(resetKey)
}

export function useAppInfoActions({ resetKey }: UseAppInfoActionsParams) {
  const { t } = useTranslation()
  const { replace } = useRouter()
  const queryClient = useQueryClient()
  const { onPlanInfoChanged } = useProviderContext()
  const appDetail = useAppStore((state) => state.appDetail)
  const setAppDetail = useAppStore((state) => state.setAppDetail)
  const { exportAppDsl, isExporting: isAppDslExporting } = useExportAppDsl()
  const { exportWorkflowAppDsl, isExporting: isWorkflowAppDslExporting } = useExportWorkflowAppDsl()
  const isExporting = isAppDslExporting || isWorkflowAppDslExporting
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled

  const [uiState, setUiState] = useState(() => createInitialUiState(resetKey))
  const uiStateMatchesResetKey = uiState.resetKey === resetKey
  const activeModal = uiStateMatchesResetKey ? uiState.activeModal : null
  const secretEnvList = uiStateMatchesResetKey ? uiState.secretEnvList : emptySecretEnvList

  const setActiveModal = useCallback<Dispatch<SetStateAction<AppInfoModalType>>>(
    (value) => {
      setUiState((state) => {
        const current = getCurrentUiState(state, resetKey)
        return {
          ...current,
          activeModal: resolveStateAction(value, current.activeModal),
        }
      })
    },
    [resetKey],
  )

  const setSecretEnvList = useCallback<Dispatch<SetStateAction<EnvironmentVariableItemResponse[]>>>(
    (value) => {
      setUiState((state) => {
        const current = getCurrentUiState(state, resetKey)
        return {
          ...current,
          secretEnvList: resolveStateAction(value, current.secretEnvList),
        }
      })
    },
    [resetKey],
  )

  const openModal = useCallback(
    (modal: Exclude<AppInfoModalType, null>) => {
      setActiveModal(modal)
    },
    [setActiveModal],
  )

  const closeModal = useCallback(() => {
    setActiveModal(null)
  }, [setActiveModal])

  const emitAppMetaUpdate = useCallback(() => {
    if (!appDetail?.id) return

    void import('@/app/components/workflow/collaboration/core/websocket-manager')
      .then(({ webSocketClient }) => {
        const socket = webSocketClient.getSocket(appDetail.id)
        if (!socket) return
        socket.emit('collaboration_event', {
          type: 'app_meta_update',
          data: { timestamp: Date.now() },
          timestamp: Date.now(),
        })
      })
      .catch(() => {})
  }, [appDetail?.id])

  useEffect(() => {
    if (!appDetail?.id) return

    let unsubscribe: (() => void) | null = null
    let disposed = false

    void import('@/app/components/workflow/collaboration/core/collaboration-manager')
      .then(({ collaborationManager }) => {
        if (disposed) return

        unsubscribe = collaborationManager.onAppMetaUpdate(async () => {
          try {
            const res = await fetchAppDetail({ url: '/apps', id: appDetail.id })
            if (disposed) return
            queryClient.setQueryData(
              consoleQuery.apps.byAppId.get.queryKey({
                input: { params: { app_id: appDetail.id } },
              }),
              (cachedApp) => updateCachedAppMetadata(cachedApp, res),
            )
            void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
            void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
            void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
            setAppDetail({ ...res })
          } catch (error) {
            console.error('failed to refresh app detail from collaboration update:', error)
          }
        })
      })
      .catch(() => {})

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [appDetail?.id, queryClient, setAppDetail])

  const onEdit: CreateAppModalProps['onConfirm'] = useCallback(
    async ({
      name,
      icon_type,
      icon,
      icon_background,
      description,
      use_icon_as_answer_icon,
      max_active_requests,
    }) => {
      if (!appDetail) return
      try {
        const app = await updateAppInfo({
          appID: appDetail.id,
          name,
          icon_type,
          icon,
          icon_background,
          description,
          use_icon_as_answer_icon,
          max_active_requests,
        })
        closeModal()
        toast(
          t(($) => $.editDone, { ns: 'app' }),
          { type: 'success' },
        )
        queryClient.setQueryData(
          consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: appDetail.id } },
          }),
          (cachedApp) => updateCachedAppMetadata(cachedApp, app),
        )
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
        setAppDetail(app)
        emitAppMetaUpdate()
      } catch {
        toast(
          t(($) => $.editFailed, { ns: 'app' }),
          { type: 'error' },
        )
      }
    },
    [appDetail, closeModal, setAppDetail, t, emitAppMetaUpdate, queryClient],
  )

  const onCopy: DuplicateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background }) => {
      if (!appDetail) return
      try {
        const newApp = await copyApp({
          appID: appDetail.id,
          name,
          icon_type,
          icon,
          icon_background,
          mode: appDetail.mode,
        })
        closeModal()
        toast(
          t(($) => $['newApp.appCreated'], { ns: 'app' }),
          { type: 'success' },
        )
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
        onPlanInfoChanged()
        getRedirection(newApp, replace, { isRbacEnabled })
      } catch {
        toast(
          t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
          { type: 'error' },
        )
      }
    },
    [appDetail, closeModal, isRbacEnabled, onPlanInfoChanged, queryClient, replace, t],
  )

  const onExport = useCallback(
    async (include = false) => {
      if (!appDetail) return
      await exportAppDsl({
        appId: appDetail.id,
        appName: appDetail.name,
        includeSecret: include,
      })
    },
    [appDetail, exportAppDsl],
  )

  const exportCheck = useCallback(async () => {
    if (!appDetail || isExporting) return
    if (appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }
    setActiveModal('exportWarning')
  }, [appDetail, isExporting, onExport, setActiveModal])

  const handleConfirmExport = useCallback(async () => {
    if (!appDetail) return
    const result = await exportWorkflowAppDsl({
      appId: appDetail.id,
      appName: appDetail.name,
    })
    if (result.status === 'confirmation-required') setSecretEnvList(result.secretEnvList)
    closeModal()
  }, [appDetail, closeModal, exportWorkflowAppDsl, setSecretEnvList])

  const onConfirmDelete = useCallback(async () => {
    if (!appDetail) return
    markAppDeletionStarted(appDetail.id)
    try {
      await deleteApp(appDetail.id)
      markAppDeletionSucceeded(appDetail.id)
      toast(
        t(($) => $.appDeleted, { ns: 'app' }),
        { type: 'success' },
      )
      void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
      void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
      onPlanInfoChanged()
      setAppDetail()
      replace('/apps')
    } catch (e: unknown) {
      markAppDeletionFailed(appDetail.id)
      toast(
        `${t(($) => $.appDeleteFailed, { ns: 'app' })}${e instanceof Error && e.message ? `: ${e.message}` : ''}`,
        { type: 'error' },
      )
    }
    closeModal()
  }, [appDetail, closeModal, onPlanInfoChanged, queryClient, replace, setAppDetail, t])

  return {
    appDetail,
    activeModal,
    openModal,
    closeModal,
    secretEnvList,
    setSecretEnvList,
    onEdit,
    onCopy,
    onExport,
    isExporting,
    exportCheck,
    handleConfirmExport,
    onConfirmDelete,
  }
}

export type AppInfoActions = ReturnType<typeof useAppInfoActions>
