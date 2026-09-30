import type {
  AppDetailWithSite,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from '@/service/app-deletion'
import { consoleClient, consoleQuery } from '@/service/console'
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

type AppMetadata = Pick<
  AppDetailWithSite,
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
    max_active_requests:
      app.max_active_requests === undefined
        ? cachedApp.max_active_requests
        : app.max_active_requests,
    name: app.name,
    updated_at: app.updated_at,
    use_icon_as_answer_icon: app.use_icon_as_answer_icon,
  }
}

export function useAppInfoActions(appDetail: Pick<AppDetailWithSite, 'id' | 'name' | 'mode'>) {
  const { t } = useTranslation(['app'])
  const { replace } = useRouter()
  const queryClient = useQueryClient()
  const { mutateAsync: copyApp } = useMutation(
    consoleQuery.apps.byAppId.copy.post.mutationOptions(),
  )
  const { mutateAsync: deleteApp } = useMutation(consoleQuery.apps.byAppId.delete.mutationOptions())
  const { exportAppDsl, isExporting: isAppDslExporting } = useExportAppDsl()
  const { exportWorkflowAppDsl, isExporting: isWorkflowAppDslExporting } = useExportWorkflowAppDsl()
  const isExporting = isAppDslExporting || isWorkflowAppDslExporting
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled

  const [activeModal, setActiveModal] = useState<AppInfoModalType>(null)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariableItemResponse[]>([])

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
  }, [appDetail.id])

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let disposed = false

    void import('@/app/components/workflow/collaboration/core/collaboration-manager')
      .then(({ collaborationManager }) => {
        if (disposed) return

        unsubscribe = collaborationManager.onAppMetaUpdate(async () => {
          try {
            const res = await consoleClient.apps.byAppId.get({ params: { app_id: appDetail.id } })
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
  }, [appDetail.id, queryClient])

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
      try {
        const app = await consoleClient.apps.byAppId.put({
          params: { app_id: appDetail.id },
          body: {
            name,
            icon_type,
            icon,
            icon_background,
            description,
            use_icon_as_answer_icon,
            max_active_requests,
          },
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
        emitAppMetaUpdate()
      } catch {
        toast(
          t(($) => $.editFailed, { ns: 'app' }),
          { type: 'error' },
        )
      }
    },
    [appDetail, closeModal, t, emitAppMetaUpdate, queryClient],
  )

  const onCopy: DuplicateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background }) => {
      try {
        const newApp = await copyApp({
          params: { app_id: appDetail.id },
          body: { name, icon_type, icon, icon_background },
        })
        if (!('mode' in newApp)) {
          toast(
            t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
            { type: 'error' },
          )
          return
        }
        closeModal()
        toast(
          t(($) => $['newApp.appCreated'], { ns: 'app' }),
          { type: 'success' },
        )
        getRedirection(newApp, replace, { isRbacEnabled })
      } catch {
        toast(
          t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
          { type: 'error' },
        )
      }
    },
    [appDetail, closeModal, copyApp, isRbacEnabled, replace, t],
  )

  const onExport = useCallback(
    async (include = false) => {
      const result = await exportAppDsl({
        appId: appDetail.id,
        appName: appDetail.name,
        includeSecret: include,
      })
      return result.status === 'downloaded'
    },
    [appDetail, exportAppDsl],
  )

  const exportCheck = useCallback(async () => {
    if (isExporting) return
    if (appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }
    setActiveModal('exportWarning')
  }, [appDetail, isExporting, onExport, setActiveModal])

  const handleConfirmExport = useCallback(async () => {
    if (isExporting) return
    const result = await exportWorkflowAppDsl({
      appId: appDetail.id,
      appName: appDetail.name,
    })
    if (result.status === 'failed') return
    if (result.status === 'confirmation-required') setSecretEnvList(result.secretEnvList)
    closeModal()
  }, [appDetail, closeModal, exportWorkflowAppDsl, isExporting, setSecretEnvList])

  const onConfirmDelete = useCallback(async () => {
    markAppDeletionStarted(appDetail.id)
    try {
      await deleteApp({ params: { app_id: appDetail.id } })
      markAppDeletionSucceeded(appDetail.id)
      toast(
        t(($) => $.appDeleted, { ns: 'app' }),
        { type: 'success' },
      )
      replace('/apps')
    } catch (e: unknown) {
      markAppDeletionFailed(appDetail.id)
      toast(
        `${t(($) => $.appDeleteFailed, { ns: 'app' })}${e instanceof Error && e.message ? `: ${e.message}` : ''}`,
        { type: 'error' },
      )
    }
    closeModal()
  }, [appDetail, closeModal, deleteApp, replace, t])

  return {
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
