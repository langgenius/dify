import type { Tag } from '@/app/components/base/tag-management/constant'
import type { DataSet } from '@/models/datasets'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useCheckDatasetUsage, useDeleteDataset } from '@/service/use-dataset-card'
import { useExportPipelineDSL } from '@/service/use-pipeline'

type ModalState = {
  showRenameModal: boolean
  showConfirmDelete: boolean
  confirmMessage: string
}

type UseDatasetCardStateOptions = {
  dataset: DataSet
  onSuccess?: () => void
}

export const useDatasetCardState = ({ dataset, onSuccess }: UseDatasetCardStateOptions) => {
  const { t } = useTranslation()
  const [tags, setTags] = useState<Tag[]>(dataset.tags)

  useEffect(() => {
    setTags(dataset.tags)
  }, [dataset.tags])

  // Modal state
  const [modalState, setModalState] = useState<ModalState>({
    showRenameModal: false,
    showConfirmDelete: false,
    confirmMessage: '',
  })

  // Export state
  const [exporting, setExporting] = useState(false)

  // Modal handlers
  const openRenameModal = useCallback(() => {
    setModalState(prev => ({ ...prev, showRenameModal: true }))
  }, [])

  const closeRenameModal = useCallback(() => {
    setModalState(prev => ({ ...prev, showRenameModal: false }))
  }, [])

  const closeConfirmDelete = useCallback(() => {
    setModalState(prev => ({ ...prev, showConfirmDelete: false }))
  }, [])

  // API mutations
  const { mutateAsync: checkUsage } = useCheckDatasetUsage()
  const { mutateAsync: deleteDatasetMutation } = useDeleteDataset()
  const { mutateAsync: exportPipelineConfig } = useExportPipelineDSL()

  // Export pipeline handler
  const handleExportPipeline = useCallback(async (include: boolean = false) => {
    const { pipeline_id, name } = dataset
    if (!pipeline_id || exporting)
      return

    try {
      setExporting(true)
      const { data } = await exportPipelineConfig({
        pipelineId: pipeline_id,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      const url = URL.createObjectURL(file)
      a.href = url
      a.download = `${name}.pipeline`
      a.click()
      URL.revokeObjectURL(url)
    }
    catch {
      Toast.notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
    finally {
      setExporting(false)
    }
  }, [dataset, exportPipelineConfig, exporting, t])

  // Delete flow handlers
  const detectIsUsedByApp = useCallback(async () => {
    try {
      const { is_using: isUsedByApp } = await checkUsage(dataset.id)
      const message = isUsedByApp
        ? t('datasetUsedByApp', { ns: 'dataset' })!
        : t('deleteDatasetConfirmContent', { ns: 'dataset' })!
      setModalState(prev => ({
        ...prev,
        confirmMessage: message,
        showConfirmDelete: true,
      }))
    }
    catch (e: unknown) {
      if (e instanceof Response) {
        const res = await e.json()
        Toast.notify({ type: 'error', message: res?.message || 'Unknown error' })
      }
      else {
        Toast.notify({ type: 'error', message: (e as Error)?.message || 'Unknown error' })
      }
    }
  }, [dataset.id, checkUsage, t])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDatasetMutation(dataset.id)
      Toast.notify({ type: 'success', message: t('datasetDeleted', { ns: 'dataset' }) })
      onSuccess?.()
    }
    finally {
      closeConfirmDelete()
    }
  }, [dataset.id, deleteDatasetMutation, onSuccess, t, closeConfirmDelete])

  return {
    // Tag state
    tags,
    setTags,

    // Modal state
    modalState,
    openRenameModal,
    closeRenameModal,
    closeConfirmDelete,

    // Export state
    exporting,

    // Handlers
    handleExportPipeline,
    detectIsUsedByApp,
    onConfirmDelete,
  }
}
