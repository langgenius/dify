'use client'
import { useDebounceFn } from 'ahooks'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '@/service/use-pipeline'

export enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}

export type UseDSLImportOptions = {
  activeTab?: CreateFromDSLModalTab
  dslUrl?: string
  onSuccess?: () => void
  onClose?: () => void
}

export type DSLVersions = {
  importedVersion: string
  systemVersion: string
}

export const useDSLImport = ({
  activeTab = CreateFromDSLModalTab.FROM_FILE,
  dslUrl = '',
  onSuccess,
  onClose,
}: UseDSLImportOptions) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

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
      notify({ type: 'error', message: t('creation.errorTip', { ns: 'datasetPipeline' }) })
      isCreatingRef.current = false
      return
    }

    const { id, status, pipeline_id, dataset_id, imported_dsl_version, current_dsl_version } = response

    if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
      onSuccess?.()
      onClose?.()

      notify({
        type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
        message: t(status === DSLImportStatus.COMPLETED ? 'creation.successTip' : 'creation.caution', { ns: 'datasetPipeline' }),
        children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('newApp.appCreateDSLWarning', { ns: 'app' }),
      })

      if (pipeline_id)
        await handleCheckPluginDependencies(pipeline_id, true)

      push(`/datasets/${dataset_id}/pipeline`)
      isCreatingRef.current = false
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
      isCreatingRef.current = false
    }
    else {
      notify({ type: 'error', message: t('creation.errorTip', { ns: 'datasetPipeline' }) })
      isCreatingRef.current = false
    }
  }, [
    currentTab,
    currentFile,
    dslUrlValue,
    fileContent,
    importDSL,
    notify,
    t,
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
    const response = await importDSLConfirm(importId)
    setIsConfirming(false)

    if (!response) {
      notify({ type: 'error', message: t('creation.errorTip', { ns: 'datasetPipeline' }) })
      return
    }

    const { status, pipeline_id, dataset_id } = response

    if (status === DSLImportStatus.COMPLETED) {
      onSuccess?.()
      setShowConfirmModal(false)

      notify({
        type: 'success',
        message: t('creation.successTip', { ns: 'datasetPipeline' }),
      })

      if (pipeline_id)
        await handleCheckPluginDependencies(pipeline_id, true)

      push(`/datasets/${dataset_id}/pipeline`)
    }
    else if (status === DSLImportStatus.FAILED) {
      notify({ type: 'error', message: t('creation.errorTip', { ns: 'datasetPipeline' }) })
    }
  }, [importId, importDSLConfirm, notify, t, onSuccess, handleCheckPluginDependencies, push])

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
