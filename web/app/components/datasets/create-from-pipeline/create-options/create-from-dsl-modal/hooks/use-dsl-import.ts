'use client'
import { toast } from '@langgenius/dify-ui/toast'
import { useDebounceFn } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '@/service/use-pipeline'

export enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}
type UseDSLImportOptions = {
  activeTab?: CreateFromDSLModalTab
  dslUrl?: string
  onSuccess?: () => void
  onClose?: () => void
}
type DSLVersions = {
  importedVersion: string
  systemVersion: string
}
type ImportErrorResponse = {
  message?: unknown
  error?: unknown
}
const getNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string')
    return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}
const getImportErrorMessage = async (error: unknown): Promise<string | undefined> => {
  if (error instanceof Response && !error.bodyUsed) {
    try {
      const errorData = await error.clone().json() as ImportErrorResponse
      return getNonEmptyString(errorData.message) ?? getNonEmptyString(errorData.error)
    }
    catch {}
  }

  if (error instanceof Error)
    return getNonEmptyString(error.message)

  return undefined
}
export const useDSLImport = ({ activeTab = CreateFromDSLModalTab.FROM_FILE, dslUrl = '', onSuccess, onClose }: UseDSLImportOptions) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [versions, setVersions] = useState<DSLVersions>()
  const [importId, setImportId] = useState<string>()
  const [isConfirming, setIsConfirming] = useState(false)
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const isCreatingRef = useRef(false)
  const { mutateAsync: importDSL } = useImportPipelineDSL()
  const { mutateAsync: importDSLConfirm } = useImportPipelineDSLConfirm()
  const notifyError = useCallback((message?: string) => {
    toast.error(message || t('creation.errorTip', { ns: 'datasetPipeline' }))
  }, [t])
  const readFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }, [])
  const handleFile = useCallback((file?: File) => {
    setDSLFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }, [readFile])
  const onCreate = useCallback(async () => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)
      return
    if (currentTab === CreateFromDSLModalTab.FROM_URL && !dslUrlValue)
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      let response
      if (currentTab === CreateFromDSLModalTab.FROM_FILE) {
        response = await importDSL({
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: fileContent || '',
        })
      }
      if (currentTab === CreateFromDSLModalTab.FROM_URL) {
        response = await importDSL({
          mode: DSLImportMode.YAML_URL,
          yaml_url: dslUrlValue || '',
        })
      }
      if (!response) {
        notifyError()
        return
      }
      const { id, status, pipeline_id, dataset_id, imported_dsl_version, current_dsl_version } = response
      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        onSuccess?.()
        onClose?.()
        toast(t(status === DSLImportStatus.COMPLETED ? 'creation.successTip' : 'creation.caution', { ns: 'datasetPipeline' }), {
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          description: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('newApp.appCreateDSLWarning', { ns: 'app' }),
        })
        if (pipeline_id)
          await handleCheckPluginDependencies(pipeline_id, true)
        push(`/datasets/${dataset_id}/pipeline`)
      }
      else if (status === DSLImportStatus.PENDING) {
        setVersions({
          importedVersion: imported_dsl_version ?? '',
          systemVersion: current_dsl_version ?? '',
        })
        onClose?.()
        setTimeout(() => {
          setShowConfirmModal(true)
        }, 300)
        setImportId(id)
      }
      else {
        notifyError(response.error)
      }
    }
    catch (error) {
      notifyError(await getImportErrorMessage(error))
    }
    finally {
      isCreatingRef.current = false
    }
  }, [
    currentTab,
    currentFile,
    dslUrlValue,
    fileContent,
    importDSL,
    t,
    notifyError,
    onSuccess,
    onClose,
    handleCheckPluginDependencies,
    push,
  ])
  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })
  const onDSLConfirm = useCallback(async () => {
    if (!importId)
      return
    setIsConfirming(true)
    try {
      const response = await importDSLConfirm(importId)
      if (!response) {
        notifyError()
        return
      }
      const { status, pipeline_id, dataset_id, error } = response
      if (status === DSLImportStatus.COMPLETED) {
        onSuccess?.()
        setShowConfirmModal(false)
        toast.success(t('creation.successTip', { ns: 'datasetPipeline' }))
        if (pipeline_id)
          await handleCheckPluginDependencies(pipeline_id, true)
        push(`/datasets/${dataset_id}/pipeline`)
      }
      else if (status === DSLImportStatus.FAILED) {
        notifyError(error)
      }
    }
    catch (error) {
      notifyError(await getImportErrorMessage(error))
    }
    finally {
      setIsConfirming(false)
    }
  }, [importId, importDSLConfirm, notifyError, t, onSuccess, handleCheckPluginDependencies, push])
  const handleCancelConfirm = useCallback(() => {
    setShowConfirmModal(false)
  }, [])
  const buttonDisabled = useMemo(() => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE)
      return !currentFile
    if (currentTab === CreateFromDSLModalTab.FROM_URL)
      return !dslUrlValue
    return false
  }, [currentTab, currentFile, dslUrlValue])
  return {
    // State
    currentFile,
    currentTab,
    dslUrlValue,
    showConfirmModal,
    versions,
    buttonDisabled,
    isConfirming,
    // Actions
    setCurrentTab,
    setDslUrlValue,
    handleFile,
    handleCreateApp,
    onDSLConfirm,
    handleCancelConfirm,
  }
}
