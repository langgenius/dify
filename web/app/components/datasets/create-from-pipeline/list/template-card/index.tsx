import type { PipelineTemplate } from '@/models/pipeline'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import { getErrorMessage } from '@/utils/error-message'
import Actions from './actions'
import Content from './content'
import Details from './details'
import EditPipelineInfo from './edit-pipeline-info'

type TemplateCardProps = {
  pipeline: PipelineTemplate
  onDelete?: (id: string) => void
  type: 'customized' | 'built-in'
}

const TemplateCard = ({ pipeline, onDelete, type }: TemplateCardProps) => {
  const { t } = useTranslation(['common', 'datasetPipeline'])
  const { push } = useRouter()
  const [showEditModal, setShowEditModal] = useState(false)

  const { refetch: getPipelineTemplateInfo } = useQuery(
    consoleQuery.rag.pipeline.templates.byTemplateId.get.queryOptions({
      input: { params: { template_id: pipeline.id }, query: { type } },
      enabled: false,
      select: selectPipelineTemplate,
      // handleUseTemplate fetches on demand and reports a failure itself.
      meta: { errorToast: false },
    }),
  )
  const { mutate: createDataset } = useMutation(
    consoleQuery.rag.pipeline.dataset.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const handleUseTemplate = useCallback(async () => {
    const { data: pipelineTemplateInfo, error } = await getPipelineTemplateInfo()
    if (error || !pipelineTemplateInfo) {
      toast.error(
        getErrorMessage(error) ?? t(($) => $['creation.errorTip'], { ns: 'datasetPipeline' }),
      )
      return
    }
    const request = {
      yaml_content: pipelineTemplateInfo.export_data,
      icon_info: pipelineTemplateInfo.icon_info,
    }
    createDataset(
      { body: request },
      {
        onSuccess: async (newDataset) => {
          toast.success(t(($) => $['creation.successTip'], { ns: 'datasetPipeline' }))
          if (newDataset.pipeline_id)
            await handleCheckPluginDependencies(newDataset.pipeline_id, true)
          trackEvent('create_datasets_with_pipeline', {
            template_name: pipeline.name,
            template_id: pipeline.id,
            template_type: type,
          })
          push(`/datasets/${newDataset.dataset_id}/pipeline`)
        },
        onError: (error) => {
          toast.error(
            getErrorMessage(error) ?? t(($) => $['creation.errorTip'], { ns: 'datasetPipeline' }),
          )
        },
      },
    )
  }, [
    getPipelineTemplateInfo,
    createDataset,
    t,
    handleCheckPluginDependencies,
    push,
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

  const { mutate: exportPipelineDSL, isPending: isExporting } = useMutation(
    consoleQuery.rag.pipeline.customized.templates.byTemplateId.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const handleExportDSL = useCallback(() => {
    if (isExporting) return
    exportPipelineDSL(
      { params: { template_id: pipeline.id } },
      {
        onSuccess: (res) => {
          const blob = new Blob([res.data], { type: 'application/yaml' })
          downloadBlob({ data: blob, fileName: `${pipeline.name}.pipeline` })
          toast.success(t(($) => $['exportDSL.successTip'], { ns: 'datasetPipeline' }))
        },
        onError: (error) => {
          toast.error(
            getErrorMessage(error) ?? t(($) => $['exportDSL.errorTip'], { ns: 'datasetPipeline' }),
          )
        },
      },
    )
  }, [t, isExporting, pipeline.id, pipeline.name, exportPipelineDSL])

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
          openEditModal={openEditModal}
          handleExportDSL={handleExportDSL}
          onDelete={onDelete ? () => onDelete(pipeline.id) : undefined}
        />
        <DialogContent
          // oxlint-disable-next-line shadcn/no-restyle -- Full-page template preview keeps its larger radius.
          className="h-dvh max-h-[calc(100dvh-4rem)] w-420 overflow-hidden rounded-3xl"
        >
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
          disablePointerDismissal
          onOpenChange={(open) => {
            if (!open) closeEditModal()
          }}
        >
          <DialogContent className="w-130">
            <EditPipelineInfo pipeline={pipeline} onClose={closeEditModal} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

export default React.memo(TemplateCard)
