'use client'

import type { ImportPipelineDSLConfirmResponse, ImportPipelineDSLResponse } from '@/models/pipeline'
import { useDebounceFn } from 'ahooks'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { toast } from '@/app/notifications'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '@/service/use-pipeline'
import { asyncRunSafe } from '@/utils'
import { getErrorMessage } from '@/utils/error-message'

export const CreateFromDSLModalTab = {
  FROM_FILE: 'from-file',
  FROM_URL: 'from-url',
} as const

export type CreateFromDSLModalTab =
  (typeof CreateFromDSLModalTab)[keyof typeof CreateFromDSLModalTab]
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
export const useDSLImport = ({
  activeTab = CreateFromDSLModalTab.FROM_FILE,
  dslUrl = '',
  onSuccess,
  onClose,
}: UseDSLImportOptions) => {
  const { push } = useRouter()
  const { t } = useTranslation(['app', 'datasetPipeline'])
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
  const notifyError = useCallback(
    (message?: string) => {
      toast.error(message || t(($) => $['creation.errorTip'], { ns: 'datasetPipeline' }))
    },
    [t],
  )
  const readFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }, [])
  const handleFile = useCallback(
    (file?: File) => {
      setDSLFile(file)
      if (file) readFile(file)
      if (!file) setFileContent('')
    },
    [readFile],
  )
  const completeImport = useCallback(
    async (response: ImportPipelineDSLResponse | ImportPipelineDSLConfirmResponse) => {
      const { status, pipeline_id, dataset_id } = response
      onSuccess?.()
      onClose?.()
      setShowConfirmModal(false)
      const [dependencyError] = pipeline_id
        ? await asyncRunSafe(handleCheckPluginDependencies(pipeline_id, true))
        : [null]
      push(`/datasets/${dataset_id}/pipeline`)
      if (dependencyError?.name === 'AbortError') return
      const isWarning = status === DSLImportStatus.COMPLETED_WITH_WARNINGS || !!dependencyError
      toast(
        t(($) => $[isWarning ? 'creation.caution' : 'creation.successTip'], {
          ns: 'datasetPipeline',
        }),
        {
          type: isWarning ? 'warning' : 'success',
          description:
            [
              status === DSLImportStatus.COMPLETED_WITH_WARNINGS &&
                t(($) => $['newApp.appCreateDSLWarning'], { ns: 'app' }),
              dependencyError?.message,
            ]
              .filter(Boolean)
              .join('\n') || undefined,
        },
      )
    },
    [onSuccess, onClose, handleCheckPluginDependencies, push, t],
  )

  const onCreate = useCallback(async () => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile) return
    if (currentTab === CreateFromDSLModalTab.FROM_URL && !dslUrlValue) return
    if (isCreatingRef.current) return
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
      const { id, status, imported_dsl_version, current_dsl_version } = response
      if (
        status === DSLImportStatus.COMPLETED ||
        status === DSLImportStatus.COMPLETED_WITH_WARNINGS
      ) {
        await completeImport(response)
      } else if (status === DSLImportStatus.PENDING) {
        setVersions({
          importedVersion: imported_dsl_version ?? '',
          systemVersion: current_dsl_version ?? '',
        })
        onClose?.()
        setTimeout(() => {
          setShowConfirmModal(true)
        }, 300)
        setImportId(id)
      } else {
        notifyError(response.error)
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        notifyError(getErrorMessage(error)?.trim() || undefined)
    } finally {
      isCreatingRef.current = false
    }
  }, [
    currentTab,
    currentFile,
    dslUrlValue,
    fileContent,
    importDSL,
    notifyError,
    onClose,
    completeImport,
  ])
  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })
  const onDSLConfirm = useCallback(async () => {
    if (!importId || isCreatingRef.current) return
    isCreatingRef.current = true
    setIsConfirming(true)
    try {
      const response = await importDSLConfirm(importId)
      if (!response) {
        notifyError()
        return
      }
      const { status, error } = response
      if (
        status === DSLImportStatus.COMPLETED ||
        status === DSLImportStatus.COMPLETED_WITH_WARNINGS
      ) {
        await completeImport(response)
      } else if (status === DSLImportStatus.FAILED) {
        notifyError(error)
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        notifyError(getErrorMessage(error)?.trim() || undefined)
    } finally {
      isCreatingRef.current = false
      setIsConfirming(false)
    }
  }, [importId, importDSLConfirm, notifyError, completeImport])
  const handleCancelConfirm = useCallback(() => {
    setShowConfirmModal(false)
  }, [])
  const buttonDisabled = useMemo(() => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE) return !currentFile
    if (currentTab === CreateFromDSLModalTab.FROM_URL) return !dslUrlValue
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
