import type { Dispatch, SetStateAction } from 'react'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { useRouter } from '@/next/navigation'
import { copyApp, deleteApp, exportAppConfig, fetchAppDetail, updateAppInfo } from '@/service/apps'
import { useInvalidateAppList } from '@/service/use-apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { downloadBlob } from '@/utils/download'

export type AppInfoModalType = 'edit' | 'duplicate' | 'delete' | 'switch' | 'importDSL' | 'exportWarning' | null

type UseAppInfoActionsParams = {
  onDetailExpand?: (expand: boolean) => void
  resetKey?: string
}

type AppInfoUiState = {
  resetKey?: string
  panelOpen: boolean
  activeModal: AppInfoModalType
  secretEnvList: EnvironmentVariable[]
}

const emptySecretEnvList: EnvironmentVariable[] = []

const createInitialUiState = (resetKey?: string): AppInfoUiState => ({
  resetKey,
  panelOpen: false,
  activeModal: null,
  secretEnvList: [],
})

const resolveStateAction = <T>(value: SetStateAction<T>, previous: T) => {
  return typeof value === 'function'
    ? (value as (previous: T) => T)(previous)
    : value
}

const getCurrentUiState = (state: AppInfoUiState, resetKey?: string) => {
  return state.resetKey === resetKey ? state : createInitialUiState(resetKey)
}

export function useAppInfoActions({ onDetailExpand, resetKey }: UseAppInfoActionsParams) {
  const { t } = useTranslation()
  const { replace } = useRouter()
  const { onPlanInfoChanged } = useProviderContext()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const invalidateAppList = useInvalidateAppList()

  const [uiState, setUiState] = useState(() => createInitialUiState(resetKey))
  const uiStateMatchesResetKey = uiState.resetKey === resetKey
  const panelOpen = uiStateMatchesResetKey ? uiState.panelOpen : false
  const activeModal = uiStateMatchesResetKey ? uiState.activeModal : null
  const secretEnvList = uiStateMatchesResetKey ? uiState.secretEnvList : emptySecretEnvList

  const setPanelOpen = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    setUiState((state) => {
      const current = getCurrentUiState(state, resetKey)
      return {
        ...current,
        panelOpen: resolveStateAction(value, current.panelOpen),
      }
    })
  }, [resetKey])

  const setActiveModal = useCallback<Dispatch<SetStateAction<AppInfoModalType>>>((value) => {
    setUiState((state) => {
      const current = getCurrentUiState(state, resetKey)
      return {
        ...current,
        activeModal: resolveStateAction(value, current.activeModal),
      }
    })
  }, [resetKey])

  const setSecretEnvList = useCallback<Dispatch<SetStateAction<EnvironmentVariable[]>>>((value) => {
    setUiState((state) => {
      const current = getCurrentUiState(state, resetKey)
      return {
        ...current,
        secretEnvList: resolveStateAction(value, current.secretEnvList),
      }
    })
  }, [resetKey])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    onDetailExpand?.(false)
  }, [onDetailExpand, setPanelOpen])

  const openModal = useCallback((modal: Exclude<AppInfoModalType, null>) => {
    closePanel()
    setActiveModal(modal)
  }, [closePanel, setActiveModal])

  const closeModal = useCallback(() => {
    setActiveModal(null)
  }, [setActiveModal])

  const emitAppMetaUpdate = useCallback(() => {
    if (!appDetail?.id)
      return

    void import('@/app/components/workflow/collaboration/core/websocket-manager')
      .then(({ webSocketClient }) => {
        const socket = webSocketClient.getSocket(appDetail.id)
        if (!socket)
          return
        socket.emit('collaboration_event', {
          type: 'app_meta_update',
          data: { timestamp: Date.now() },
          timestamp: Date.now(),
        })
      })
      .catch(() => { })
  }, [appDetail?.id])

  useEffect(() => {
    if (!appDetail?.id)
      return

    let unsubscribe: (() => void) | null = null
    let disposed = false

    void import('@/app/components/workflow/collaboration/core/collaboration-manager')
      .then(({ collaborationManager }) => {
        if (disposed)
          return

        unsubscribe = collaborationManager.onAppMetaUpdate(async () => {
          try {
            const res = await fetchAppDetail({ url: '/apps', id: appDetail.id })
            if (disposed)
              return
            setAppDetail({ ...res })
          }
          catch (error) {
            console.error('failed to refresh app detail from collaboration update:', error)
          }
        })
      })
      .catch(() => { })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [appDetail?.id, setAppDetail])

  const onEdit: CreateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
    use_icon_as_answer_icon,
    max_active_requests,
  }) => {
    if (!appDetail)
      return
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
      toast(t('editDone', { ns: 'app' }), { type: 'success' })
      setAppDetail(app)
      emitAppMetaUpdate()
    }
    catch {
      toast(t('editFailed', { ns: 'app' }), { type: 'error' })
    }
  }, [appDetail, closeModal, setAppDetail, t, emitAppMetaUpdate])

  const onCopy: DuplicateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
  }) => {
    if (!appDetail)
      return
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
      toast(t('newApp.appCreated', { ns: 'app' }), { type: 'success' })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      onPlanInfoChanged()
      getRedirection(true, newApp, replace)
    }
    catch {
      toast(t('newApp.appCreateFailed', { ns: 'app' }), { type: 'error' })
    }
  }, [appDetail, closeModal, onPlanInfoChanged, replace, t])

  const onExport = useCallback(async (include = false) => {
    if (!appDetail)
      return
    try {
      const { data } = await exportAppConfig({ appID: appDetail.id, include })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${appDetail.name}.yml` })
    }
    catch {
      toast(t('exportFailed', { ns: 'app' }), { type: 'error' })
    }
  }, [appDetail, t])

  const exportCheck = useCallback(async () => {
    if (!appDetail)
      return
    if (appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }
    setActiveModal('exportWarning')
  }, [appDetail, onExport, setActiveModal])

  const handleConfirmExport = useCallback(async () => {
    if (!appDetail)
      return
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${appDetail.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
      if (list.length === 0) {
        onExport()
        return
      }
      setSecretEnvList(list)
    }
    catch {
      toast(t('exportFailed', { ns: 'app' }), { type: 'error' })
    }
    finally {
      closeModal()
    }
  }, [appDetail, closeModal, onExport, setSecretEnvList, t])

  const onConfirmDelete = useCallback(async () => {
    if (!appDetail)
      return
    try {
      await deleteApp(appDetail.id)
      toast(t('appDeleted', { ns: 'app' }), { type: 'success' })
      invalidateAppList()
      onPlanInfoChanged()
      setAppDetail()
      replace('/apps')
    }
    catch (e: unknown) {
      toast(`${t('appDeleteFailed', { ns: 'app' })}${e instanceof Error && e.message ? `: ${e.message}` : ''}`, { type: 'error' })
    }
    closeModal()
  }, [appDetail, closeModal, invalidateAppList, onPlanInfoChanged, replace, setAppDetail, t])

  return {
    appDetail,
    panelOpen,
    setPanelOpen,
    closePanel,
    activeModal,
    openModal,
    closeModal,
    secretEnvList,
    setSecretEnvList,
    onEdit,
    onCopy,
    onExport,
    exportCheck,
    handleConfirmExport,
    onConfirmDelete,
  }
}

export type AppInfoActions = ReturnType<typeof useAppInfoActions>
