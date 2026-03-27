'use client'

import type { CreateFromDSLModalTab } from './index'
import type { AppModeEnum } from '@/types/app'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useKeyPress } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/components/base/ui/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import { useRouter } from '@/next/navigation'
import {
  importAppBundle,
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
import { getRedirection } from '@/utils/app-redirection'

type CreateFromDSLModalStateParams = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab: CreateFromDSLModalTab
  dslUrl: string
  droppedFile?: File
  appManagementLocalizedPathMap: Record<string, DocPathWithoutLang>
}

export const useCreateFromDSLModal = ({
  show,
  onSuccess,
  onClose,
  activeTab,
  dslUrl,
  droppedFile,
  appManagementLocalizedPathMap,
}: CreateFromDSLModalStateParams) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()

  const [currentFile, setCurrentFile] = useState<File | undefined>(() => droppedFile)
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const [isCreating, setIsCreating] = useState(false)

  const isCreatingRef = useRef(false)
  const isMountedRef = useRef(true)

  const isZipFile = useCallback((file?: File) => !!file && file.name.toLowerCase().endsWith('.zip'), [])

  const readFileContent = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        resolve(String(event.target?.result || ''))
      }
      reader.onerror = () => {
        reject(new Error(`Unable to read ${file.name}`))
      }
      reader.readAsText(file)
    })
  }, [])

  const handleFile = useCallback((file?: File) => {
    setCurrentFile(file)
  }, [])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const isAppsFull = enableBilling && plan.usage.buildApps >= plan.total.buildApps

  const handleImportSuccess = useCallback(async (status: DSLImportStatus, appId?: string, appMode?: AppModeEnum) => {
    if (onSuccess)
      onSuccess()
    onClose()

    toast(
      t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }),
      {
        type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
        description: status === DSLImportStatus.COMPLETED_WITH_WARNINGS
          ? t('newApp.appCreateDSLWarning', { ns: 'app' })
          : undefined,
      },
    )
    localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
    if (appId)
      await handleCheckPluginDependencies(appId)
    if (appId && appMode)
      getRedirection(isCurrentWorkspaceEditor, { id: appId, mode: appMode }, push)
  }, [handleCheckPluginDependencies, isCurrentWorkspaceEditor, onClose, onSuccess, push, t])

  const handlePendingImport = useCallback((id?: string, importedVersion?: string | null, currentVersion?: string | null) => {
    setVersions({
      importedVersion: importedVersion ?? '',
      systemVersion: currentVersion ?? '',
    })
    setTimeout(() => {
      setShowErrorModal(true)
    }, 300)
    setImportId(id)
  }, [])

  const handleCreate = useCallback(async () => {
    if (currentTab === 'from-file' && !currentFile)
      return
    if (currentTab === 'from-url' && !dslUrlValue)
      return
    if (isCreatingRef.current)
      return

    isCreatingRef.current = true
    setIsCreating(true)

    try {
      const response = currentTab === 'from-file'
        ? (isZipFile(currentFile)
            ? await importAppBundle({ file: currentFile! })
            : await importDSL({
                mode: DSLImportMode.YAML_CONTENT,
                yaml_content: await readFileContent(currentFile!),
              }))
        : await importDSL({
            mode: DSLImportMode.YAML_URL,
            yaml_url: dslUrlValue || '',
          })

      if (!response)
        return

      const { id, status, app_id, app_mode, imported_dsl_version, current_dsl_version } = response
      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        trackEvent('create_app_with_dsl', {
          app_mode,
          creation_method: currentTab === 'from-file' ? 'dsl_file' : 'dsl_url',
          has_warnings: status === DSLImportStatus.COMPLETED_WITH_WARNINGS,
        })
        await handleImportSuccess(status, app_id, app_mode as AppModeEnum | undefined)
        return
      }

      if (status === DSLImportStatus.PENDING) {
        handlePendingImport(id, imported_dsl_version, current_dsl_version)
        return
      }

      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
    finally {
      isCreatingRef.current = false
      if (isMountedRef.current)
        setIsCreating(false)
    }
  }, [currentFile, currentTab, dslUrlValue, handleImportSuccess, handlePendingImport, isZipFile, readFileContent, t])

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (!show || isAppsFull)
      return

    const canCreate = (currentTab === 'from-file' && currentFile) || (currentTab === 'from-url' && dslUrlValue)
    if (canCreate)
      handleCreate()
  })

  useKeyPress('esc', () => {
    if (show && !showErrorModal)
      onClose()
  })

  const handleDSLConfirm = useCallback(async () => {
    try {
      if (!importId)
        return

      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id, app_mode } = response
      if (status === DSLImportStatus.COMPLETED) {
        await handleImportSuccess(status, app_id, app_mode as AppModeEnum | undefined)
        return
      }

      if (status === DSLImportStatus.FAILED)
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
  }, [handleImportSuccess, importId, t])

  const handleConfirmSuccess = useCallback(() => {
    if (onSuccess)
      onSuccess()
    onClose()
  }, [onClose, onSuccess])

  const tabs = useMemo<Array<{ key: CreateFromDSLModalTab, label: string }>>(() => ([
    {
      key: 'from-file' as CreateFromDSLModalTab,
      label: t('importFromDSLFile', { ns: 'app' }),
    },
    {
      key: 'from-url' as CreateFromDSLModalTab,
      label: t('importFromDSLUrl', { ns: 'app' }),
    },
  ]), [t])

  const buttonDisabled = useMemo(() => {
    if (isAppsFull)
      return true
    if (currentTab === 'from-file')
      return !currentFile
    if (currentTab === 'from-url')
      return !dslUrlValue
    return false
  }, [currentFile, currentTab, dslUrlValue, isAppsFull])

  const learnMoreLabel = t('importFromDSLModal.learnMore', {
    ns: 'app',
    defaultValue: t('newApp.learnMore', { ns: 'app' }),
  })

  return {
    buttonDisabled,
    currentFile,
    currentTab,
    docHref: docLink('/use-dify/workspace/app-management#app-export-and-import', appManagementLocalizedPathMap),
    dslUrlValue,
    handleConfirmSuccess,
    handleCreate,
    handleDSLConfirm,
    handleFile,
    isAppsFull,
    isCreating,
    isZipFile,
    learnMoreLabel,
    setCurrentTab,
    setDslUrlValue,
    setShowErrorModal,
    showErrorModal,
    tabs,
    versions,
  }
}
