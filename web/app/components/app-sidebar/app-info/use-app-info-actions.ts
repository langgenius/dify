import type { EnvironmentVariableItemResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import { skipToken, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useParams, useRouter } from '@/next/navigation'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from '@/service/app-deletion'
import { consoleQuery } from '@/service/console'
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

export function useAppInfoActions() {
  const { t } = useTranslation(['app'])
  const { replace } = useRouter()
  const { appId } = useParams<{ appId: string }>()
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const { mutateAsync: updateApp } = useMutation(consoleQuery.apps.byAppId.put.mutationOptions())
  const { mutateAsync: copyApp } = useMutation(
    consoleQuery.apps.byAppId.copy.post.mutationOptions(),
  )
  const { mutateAsync: deleteApp } = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions({
      onSuccess: (_data, { params }) => {
        markAppDeletionSucceeded(params.app_id)
      },
      onError: (_error, { params }) => {
        markAppDeletionFailed(params.app_id)
      },
    }),
  )
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
        await updateApp({
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
        emitAppMetaUpdate()
      } catch {
        toast(
          t(($) => $.editFailed, { ns: 'app' }),
          { type: 'error' },
        )
      }
    },
    [appDetail, closeModal, t, emitAppMetaUpdate, updateApp],
  )

  const onCopy: DuplicateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background }) => {
      if (!appDetail) return
      try {
        await copyApp(
          {
            params: { app_id: appDetail.id },
            body: { name, icon_type, icon, icon_background },
          },
          {
            onSuccess: (newApp) => {
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
            },
            onError: () => {
              toast(
                t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
                { type: 'error' },
              )
            },
          },
        )
      } catch {
        // The mounted mutation observer owns feedback; the modal only awaits completion.
      }
    },
    [appDetail, closeModal, copyApp, isRbacEnabled, replace, t],
  )

  const onExport = useCallback(
    async (include = false) => {
      if (!appDetail) return false
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
    if (!appDetail || isExporting) return
    if (appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }
    setActiveModal('exportWarning')
  }, [appDetail, isExporting, onExport, setActiveModal])

  const handleConfirmExport = useCallback(async () => {
    if (!appDetail || isExporting) return
    const result = await exportWorkflowAppDsl({
      appId: appDetail.id,
      appName: appDetail.name,
    })
    if (result.status === 'failed') return
    if (result.status === 'confirmation-required') setSecretEnvList(result.secretEnvList)
    closeModal()
  }, [appDetail, closeModal, exportWorkflowAppDsl, isExporting, setSecretEnvList])

  const onConfirmDelete = useCallback(async () => {
    if (!appDetail) return
    markAppDeletionStarted(appDetail.id)
    try {
      await deleteApp(
        { params: { app_id: appDetail.id } },
        {
          onSuccess: () => {
            toast(
              t(($) => $.appDeleted, { ns: 'app' }),
              { type: 'success' },
            )
            replace('/apps')
          },
          onError: (error) => {
            toast(
              `${t(($) => $.appDeleteFailed, { ns: 'app' })}${error instanceof Error && error.message ? `: ${error.message}` : ''}`,
              { type: 'error' },
            )
          },
          onSettled: closeModal,
        },
      )
    } catch {
      // The mounted mutation observer owns feedback; the modal only awaits completion.
    }
  }, [appDetail, closeModal, deleteApp, replace, t])

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
