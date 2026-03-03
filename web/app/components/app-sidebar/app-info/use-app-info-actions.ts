import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { copyApp, deleteApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import { useInvalidateAppList } from '@/service/use-apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { downloadBlob } from '@/utils/download'

export type AppInfoModalType = 'edit' | 'duplicate' | 'delete' | 'switch' | 'importDSL' | 'exportWarning' | null

type UseAppInfoActionsParams = {
  onDetailExpand?: (expand: boolean) => void
}

export function useAppInfoActions({ onDetailExpand }: UseAppInfoActionsParams) {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { replace } = useRouter()
  const { onPlanInfoChanged } = useProviderContext()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const invalidateAppList = useInvalidateAppList()

  const [panelOpen, setPanelOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<AppInfoModalType>(null)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    onDetailExpand?.(false)
  }, [onDetailExpand])

  const openModal = useCallback((modal: Exclude<AppInfoModalType, null>) => {
    closePanel()
    setActiveModal(modal)
  }, [closePanel])

  const closeModal = useCallback(() => {
    setActiveModal(null)
  }, [])

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
      notify({ type: 'success', message: t('editDone', { ns: 'app' }) })
      setAppDetail(app)
    }
    catch {
      notify({ type: 'error', message: t('editFailed', { ns: 'app' }) })
    }
  }, [appDetail, closeModal, notify, setAppDetail, t])

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
      notify({ type: 'success', message: t('newApp.appCreated', { ns: 'app' }) })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      onPlanInfoChanged()
      getRedirection(true, newApp, replace)
    }
    catch {
      notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
    }
  }, [appDetail, closeModal, notify, onPlanInfoChanged, replace, t])

  const onExport = useCallback(async (include = false) => {
    if (!appDetail)
      return
    try {
      const { data } = await exportAppConfig({ appID: appDetail.id, include })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${appDetail.name}.yml` })
    }
    catch {
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
  }, [appDetail, notify, t])

  const exportCheck = useCallback(async () => {
    if (!appDetail)
      return
    if (appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }
    setActiveModal('exportWarning')
  }, [appDetail, onExport])

  const handleConfirmExport = useCallback(async () => {
    if (!appDetail)
      return
    closeModal()
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
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
  }, [appDetail, closeModal, notify, onExport, t])

  const onConfirmDelete = useCallback(async () => {
    if (!appDetail)
      return
    try {
      await deleteApp(appDetail.id)
      notify({ type: 'success', message: t('appDeleted', { ns: 'app' }) })
      invalidateAppList()
      onPlanInfoChanged()
      setAppDetail()
      replace('/apps')
    }
    catch (e: unknown) {
      notify({
        type: 'error',
        message: `${t('appDeleteFailed', { ns: 'app' })}${e instanceof Error && e.message ? `: ${e.message}` : ''}`,
      })
    }
    closeModal()
  }, [appDetail, closeModal, invalidateAppList, notify, onPlanInfoChanged, replace, setAppDetail, t])

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
