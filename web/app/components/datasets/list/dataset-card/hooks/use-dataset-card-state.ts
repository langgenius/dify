import type { DataSet } from '@/models/datasets'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useExportPipelineDSL } from '@/service/use-pipeline'
import { downloadBlob } from '@/utils/download'

type ModalState = {
  showRenameModal: boolean
  showConfirmDelete: boolean
  showAccessConfig: boolean
  confirmMessage: string
}

type UseDatasetCardStateOptions = {
  dataset: DataSet
  onSuccess?: () => void
}

export const useDatasetCardState = ({ dataset, onSuccess }: UseDatasetCardStateOptions) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const queryClient = useQueryClient()

  // Modal state
  const [modalState, setModalState] = useState<ModalState>({
    showRenameModal: false,
    showConfirmDelete: false,
    showAccessConfig: false,
    confirmMessage: '',
  })

  // Export state
  const [exporting, setExporting] = useState(false)

  // Modal handlers
  const openRenameModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, showRenameModal: true }))
  }, [])

  const closeRenameModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, showRenameModal: false }))
  }, [])

  const closeConfirmDelete = useCallback(() => {
    setModalState((prev) => ({ ...prev, showConfirmDelete: false }))
  }, [])

  const openAccessConfig = useCallback(() => {
    push(`/datasets/${dataset.id}/access-config`)
  }, [dataset.id, push])

  const closeAccessConfig = useCallback(() => {
    setModalState((prev) => ({ ...prev, showAccessConfig: false }))
  }, [])

  // API mutations
  const { mutateAsync: deleteDatasetMutation } = useMutation(
    consoleQuery.datasets.byDatasetId.delete.mutationOptions(),
  )
  const { mutateAsync: exportPipelineConfig } = useExportPipelineDSL()

  // Export pipeline handler
  const handleExportPipeline = useCallback(
    async (include: boolean = false) => {
      const { pipeline_id, name } = dataset
      if (!pipeline_id || exporting) return

      try {
        setExporting(true)
        const { data } = await exportPipelineConfig({
          pipelineId: pipeline_id,
          include,
        })
        const file = new Blob([data], { type: 'application/yaml' })
        downloadBlob({ data: file, fileName: `${name}.pipeline` })
      } catch {
        toast.error(t(($) => $.exportFailed, { ns: 'app' }))
      } finally {
        setExporting(false)
      }
    },
    [dataset, exportPipelineConfig, exporting, t],
  )

  // Delete flow handlers
  const detectIsUsedByApp = useCallback(async () => {
    try {
      const { is_using: isUsedByApp } = await queryClient.fetchQuery(
        consoleQuery.datasets.byDatasetId.useCheck.get.queryOptions({
          input: {
            params: {
              dataset_id: dataset.id,
            },
          },
          staleTime: 0,
          retry: false,
          context: { silent: true },
        }),
      )
      const message = isUsedByApp
        ? t(($) => $.datasetUsedByApp, { ns: 'dataset' })!
        : t(($) => $.deleteDatasetConfirmContent, { ns: 'dataset' })!
      setModalState((prev) => ({
        ...prev,
        confirmMessage: message,
        showConfirmDelete: true,
      }))
    } catch (e: unknown) {
      if (e instanceof Response) {
        const res = await e.json()
        toast.error(res?.message || t(($) => $.unknownError, { ns: 'dataset' }))
      } else {
        toast.error((e as Error)?.message || t(($) => $.unknownError, { ns: 'dataset' }))
      }
    }
  }, [dataset.id, queryClient, t])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDatasetMutation({
        params: {
          dataset_id: dataset.id,
        },
      })
      toast.success(t(($) => $.datasetDeleted, { ns: 'dataset' }))
      onSuccess?.()
    } finally {
      closeConfirmDelete()
    }
  }, [dataset.id, deleteDatasetMutation, onSuccess, t, closeConfirmDelete])

  return {
    // Modal state
    modalState,
    openRenameModal,
    closeRenameModal,
    closeConfirmDelete,
    openAccessConfig,
    closeAccessConfig,

    // Export state
    exporting,

    // Handlers
    handleExportPipeline,
    detectIsUsedByApp,
    onConfirmDelete,
  }
}
