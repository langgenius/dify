import type { PipelineTemplate } from '@/models/pipeline'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { selectPipelineTemplate } from '@/app/components/rag-pipeline/utils/query-select'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import Actions from './actions'
import Content from './content'
import Details from './details'
import EditPipelineInfo from './edit-pipeline-info'

type TemplateCardProps = {
  pipeline: PipelineTemplate
  showMoreOperations?: boolean
  type: 'customized' | 'built-in'
}

const TemplateCard = ({ pipeline, showMoreOperations = true, type }: TemplateCardProps) => {
  const { t } = useTranslation(['common', 'datasetPipeline'])
  const { push } = useRouter()
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowConfirmDelete] = useState(false)

  const queryClient = useQueryClient()
  const { refetch: getPipelineTemplateInfo } = useQuery(
    consoleQuery.rag.pipeline.templates.byTemplateId.get.queryOptions({
      input: { params: { template_id: pipeline.id }, query: { type } },
      enabled: false,
      select: selectPipelineTemplate,
    }),
  )
  const { mutateAsync: createDataset } = useMutation(
    consoleQuery.rag.pipeline.dataset.post.mutationOptions(),
  )
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const invalidDatasetList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
  }, [queryClient])

  const handleUseTemplate = useCallback(async () => {
    const { data: pipelineTemplateInfo } = await getPipelineTemplateInfo()
    if (!pipelineTemplateInfo) {
      toast.error(t(($) => $['creation.errorTip'], { ns: 'datasetPipeline' }))
      return
    }
    const request = {
      yaml_content: pipelineTemplateInfo.export_data,
    }
    await createDataset(
      { body: request },
      {
        onSuccess: async (newDataset) => {
          toast.success(t(($) => $['creation.successTip'], { ns: 'datasetPipeline' }))
          invalidDatasetList()
          if (newDataset.pipeline_id)
            await handleCheckPluginDependencies(newDataset.pipeline_id, true)
          trackEvent('create_datasets_with_pipeline', {
            template_name: pipeline.name,
            template_id: pipeline.id,
            template_type: type,
          })
          push(`/datasets/${newDataset.dataset_id}/pipeline`)
        },
        onError: () => {
          toast.error(t(($) => $['creation.errorTip'], { ns: 'datasetPipeline' }))
        },
      },
    )
  }, [
    getPipelineTemplateInfo,
    createDataset,
    t,
    handleCheckPluginDependencies,
    push,
    invalidDatasetList,
    pipeline.name,
    pipeline.id,
    type,
  ])

  const openEditModal = useCallback(() => {
    setShowEditModal(true)
  }, [])

  const closeEditModal = useCallback(() => {
    setShowEditModal(false)
  }, [])

  const { mutateAsync: exportPipelineDSL, isPending: isExporting } = useMutation(
    consoleQuery.rag.pipeline.customized.templates.byTemplateId.post.mutationOptions(),
  )

  const handleExportDSL = useCallback(async () => {
    if (isExporting) return
    await exportPipelineDSL(
      { params: { template_id: pipeline.id } },
      {
        onSuccess: (res) => {
          const blob = new Blob([res.data], { type: 'application/yaml' })
          downloadBlob({ data: blob, fileName: `${pipeline.name}.pipeline` })
          toast.success(t(($) => $['exportDSL.successTip'], { ns: 'datasetPipeline' }))
        },
        onError: () => {
          toast.error(t(($) => $['exportDSL.errorTip'], { ns: 'datasetPipeline' }))
        },
      },
    )
  }, [t, isExporting, pipeline.id, pipeline.name, exportPipelineDSL])

  const handleDelete = useCallback(() => {
    setShowConfirmDelete(true)
  }, [])

  const onCancelDelete = useCallback(() => {
    setShowConfirmDelete(false)
  }, [])

  const { mutateAsync: deletePipeline } = useMutation(
    consoleQuery.rag.pipeline.customized.templates.byTemplateId.delete.mutationOptions(),
  )

  const onConfirmDelete = useCallback(async () => {
    await deletePipeline(
      { params: { template_id: pipeline.id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: consoleQuery.rag.pipeline.templates.get.queryKey({
              input: { query: { type: 'customized' } },
            }),
          })
          setShowConfirmDelete(false)
        },
      },
    )
  }, [pipeline.id, deletePipeline, queryClient])

  return (
    <div className="group relative flex h-33 cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3">
      <Content
        name={pipeline.name}
        description={pipeline.description}
        iconInfo={pipeline.icon}
        chunkStructure={pipeline.chunk_structure}
      />
      <Dialog>
        <Actions
          onApplyTemplate={handleUseTemplate}
          showMoreOperations={showMoreOperations}
          openEditModal={openEditModal}
          handleExportDSL={handleExportDSL}
          handleDelete={handleDelete}
        />
        <DialogContent className="h-[calc(100dvh-64px)] max-h-[calc(100dvh-64px)] w-[calc(100vw-2rem)] max-w-[1680px]! overflow-hidden! rounded-3xl border-none p-0 text-left align-middle">
          <Details
            id={pipeline.id}
            type={type}
            name={pipeline.name}
            onApplyTemplate={handleUseTemplate}
          />
        </DialogContent>
      </Dialog>
      {showEditModal && (
        <Dialog
          open={showEditModal}
          onOpenChange={(open) => {
            if (!open) closeEditModal()
          }}
        >
          <DialogContent className="w-[calc(100vw-2rem)] max-w-130! overflow-hidden! border-none p-0 text-left align-middle">
            <EditPipelineInfo pipeline={pipeline} onClose={closeEditModal} />
          </DialogContent>
        </Dialog>
      )}
      <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => !open && onCancelDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="truncate">
              {t(($) => $['deletePipeline.title'], { ns: 'datasetPipeline' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['deletePipeline.content'], { ns: 'datasetPipeline' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onConfirmDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default React.memo(TemplateCard)
