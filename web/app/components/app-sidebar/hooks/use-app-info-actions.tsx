import type { Operation } from '../components/app-operations'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiExchange2Line,
  RiFileCopy2Line,
  RiFileDownloadLine,
  RiFileUploadLine,
} from '@remixicon/react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
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

// Lookup table replacing chained ternary for mode labels
type AppModeI18nKey = 'types.advanced' | 'types.agent' | 'types.chatbot' | 'types.completion' | 'types.workflow'

const APP_MODE_I18N_KEY: Record<string, AppModeI18nKey> = {
  [AppModeEnum.ADVANCED_CHAT]: 'types.advanced',
  [AppModeEnum.AGENT_CHAT]: 'types.agent',
  [AppModeEnum.CHAT]: 'types.chatbot',
  [AppModeEnum.COMPLETION]: 'types.completion',
  [AppModeEnum.WORKFLOW]: 'types.workflow',
}

export function getAppModeI18nKey(mode: string): AppModeI18nKey {
  return APP_MODE_I18N_KEY[mode] ?? 'types.workflow'
}

export type ActiveModal = 'edit' | 'duplicate' | 'confirmDelete' | 'switch' | 'importDSL' | null

type UseAppInfoActionsParams = {
  closePanel: () => void
}

export function useAppInfoActions({ closePanel }: UseAppInfoActionsParams) {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { replace } = useRouter()
  const { onPlanInfoChanged } = useProviderContext()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const invalidateAppList = useInvalidateAppList()

  // Unified modal state: only one modal active at a time
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  // Export warning and secret env list are independent of activeModal,
  // because they can be shown alongside other modals (e.g. importDSL).
  const [showExportWarning, setShowExportWarning] = useState(false)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])

  const openModal = useCallback((modal: NonNullable<ActiveModal>) => {
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

  const onCopy: DuplicateAppModalProps['onConfirm'] = useCallback(async ({ name, icon_type, icon, icon_background }) => {
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
    setShowExportWarning(true)
  }, [appDetail, onExport])

  const handleConfirmExport = useCallback(async () => {
    if (!appDetail)
      return
    setShowExportWarning(false)
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
  }, [appDetail, notify, onExport, t])

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
      const errorMessage = (typeof e === 'object' && e !== null && 'message' in e)
        ? `: ${(e as { message: string }).message}`
        : ''
      notify({
        type: 'error',
        message: `${t('appDeleteFailed', { ns: 'app' })}${errorMessage}`,
      })
    }
    closeModal()
  }, [appDetail, closeModal, invalidateAppList, notify, onPlanInfoChanged, replace, setAppDetail, t])

  // Build operation lists
  const isWorkflowLike = appDetail?.mode === AppModeEnum.ADVANCED_CHAT || appDetail?.mode === AppModeEnum.WORKFLOW

  const primaryOperations = useMemo<Operation[]>(() => [
    { id: 'edit', title: t('editApp', { ns: 'app' }), icon: <RiEditLine />, onClick: () => openModal('edit') },
    { id: 'duplicate', title: t('duplicate', { ns: 'app' }), icon: <RiFileCopy2Line />, onClick: () => openModal('duplicate') },
    { id: 'export', title: t('export', { ns: 'app' }), icon: <RiFileDownloadLine />, onClick: exportCheck },
  ], [t, openModal, exportCheck])

  const secondaryOperations = useMemo<Operation[]>(() => [
    ...(isWorkflowLike
      ? [{ id: 'import', title: t('common.importDSL', { ns: 'workflow' }), icon: <RiFileUploadLine />, onClick: () => openModal('importDSL') }]
      : []),
    { id: 'divider-1', title: '', icon: <></>, onClick: () => { }, type: 'divider' as const },
    { id: 'delete', title: t('operation.delete', { ns: 'common' }), icon: <RiDeleteBinLine />, onClick: () => openModal('confirmDelete') },
  ], [t, isWorkflowLike, openModal])

  const isBasicApp = appDetail?.mode === AppModeEnum.COMPLETION || appDetail?.mode === AppModeEnum.CHAT
  const switchOperation = useMemo(() => {
    if (!isBasicApp)
      return null
    return { id: 'switch', title: t('switch', { ns: 'app' }), icon: <RiExchange2Line />, onClick: () => openModal('switch') }
  }, [isBasicApp, t, openModal])

  return {
    appDetail,
    activeModal,
    showExportWarning,
    secretEnvList,
    closeModal,
    closeExportWarning: useCallback(() => setShowExportWarning(false), []),
    clearSecretEnvList: useCallback(() => setSecretEnvList([]), []),
    onEdit,
    onCopy,
    onExport,
    exportCheck,
    handleConfirmExport,
    onConfirmDelete,
    primaryOperations,
    secondaryOperations,
    switchOperation,
  }
}
