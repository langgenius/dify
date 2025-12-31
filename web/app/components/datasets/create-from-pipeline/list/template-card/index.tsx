import type { PipelineTemplate } from '@/models/pipeline'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Confirm from '@/app/components/base/confirm'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useCreatePipelineDatasetFromCustomized } from '@/service/knowledge/use-create-dataset'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import {
  useDeleteTemplate,
  useExportTemplateDSL,
  useInvalidCustomizedTemplateList,
  usePipelineTemplateById,
} from '@/service/use-pipeline'
import { downloadFile } from '@/utils/format'
import Actions from './actions'
import Content from './content'
import Details from './details'
import EditPipelineInfo from './edit-pipeline-info'

type TemplateCardProps = {
  pipeline: PipelineTemplate
  showMoreOperations?: boolean
  type: 'customized' | 'built-in'
}

const TemplateCard = ({
  pipeline,
  showMoreOperations = true,
  type,
}: TemplateCardProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowConfirmDelete] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)

  const { refetch: getPipelineTemplateInfo } = usePipelineTemplateById({
    template_id: pipeline.id,
    type,
  }, false)
  const { mutateAsync: createDataset } = useCreatePipelineDatasetFromCustomized()
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const invalidDatasetList = useInvalidDatasetList()

  const handleUseTemplate = useCallback(async () => {
    const { data: pipelineTemplateInfo } = await getPipelineTemplateInfo()
    if (!pipelineTemplateInfo) {
      Toast.notify({
        type: 'error',
        message: t('creation.errorTip', { ns: 'datasetPipeline' }),
      })
      return
    }
    const request = {
      yaml_content: pipelineTemplateInfo.export_data,
    }
    await createDataset(request, {
      onSuccess: async (newDataset) => {
        Toast.notify({
          type: 'success',
          message: t('creation.successTip', { ns: 'datasetPipeline' }),
        })
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
        Toast.notify({
          type: 'error',
          message: t('creation.errorTip', { ns: 'datasetPipeline' }),
        })
      },
    })
  }, [getPipelineTemplateInfo, createDataset, t, handleCheckPluginDependencies, push, invalidDatasetList, pipeline.name, pipeline.id, type])

  const handleShowTemplateDetails = useCallback(() => {
    setShowDetailModal(true)
  }, [])

  const openEditModal = useCallback(() => {
    setShowEditModal(true)
  }, [])

  const closeEditModal = useCallback(() => {
    setShowEditModal(false)
  }, [])

  const closeDetailsModal = useCallback(() => {
    setShowDetailModal(false)
  }, [])

  const { mutateAsync: exportPipelineDSL, isPending: isExporting } = useExportTemplateDSL()

  const handleExportDSL = useCallback(async () => {
    if (isExporting)
      return
    await exportPipelineDSL(pipeline.id, {
      onSuccess: (res) => {
        const blob = new Blob([res.data], { type: 'application/yaml' })
        downloadFile({
          data: blob,
          fileName: `${pipeline.name}.pipeline`,
        })
        Toast.notify({
          type: 'success',
          message: t('exportDSL.successTip', { ns: 'datasetPipeline' }),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('exportDSL.errorTip', { ns: 'datasetPipeline' }),
        })
      },
    })
  }, [t, isExporting, pipeline.id, pipeline.name, exportPipelineDSL])

  const handleDelete = useCallback(() => {
    setShowConfirmDelete(true)
  }, [])

  const onCancelDelete = useCallback(() => {
    setShowConfirmDelete(false)
  }, [])

  const { mutateAsync: deletePipeline } = useDeleteTemplate()
  const invalidCustomizedTemplateList = useInvalidCustomizedTemplateList()

  const onConfirmDelete = useCallback(async () => {
    await deletePipeline(pipeline.id, {
      onSuccess: () => {
        invalidCustomizedTemplateList()
        setShowConfirmDelete(false)
      },
    })
  }, [pipeline.id, deletePipeline, invalidCustomizedTemplateList])

  return (
    <div className="group relative flex h-[132px] cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3">
      <Content
        name={pipeline.name}
        description={pipeline.description}
        iconInfo={pipeline.icon}
        chunkStructure={pipeline.chunk_structure}
      />
      <Actions
        onApplyTemplate={handleUseTemplate}
        handleShowTemplateDetails={handleShowTemplateDetails}
        showMoreOperations={showMoreOperations}
        openEditModal={openEditModal}
        handleExportDSL={handleExportDSL}
        handleDelete={handleDelete}
      />
      {showEditModal && (
        <Modal
          isShow={showEditModal}
          onClose={closeEditModal}
          className="max-w-[520px] p-0"
        >
          <EditPipelineInfo
            pipeline={pipeline}
            onClose={closeEditModal}
          />
        </Modal>
      )}
      {showDeleteConfirm && (
        <Confirm
          title={t('deletePipeline.title', { ns: 'datasetPipeline' })}
          content={t('deletePipeline.content', { ns: 'datasetPipeline' })}
          isShow={showDeleteConfirm}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}
      {showDetailModal && (
        <Modal
          isShow={showDetailModal}
          onClose={closeDetailsModal}
          className="h-[calc(100vh-64px)] max-w-[1680px] rounded-3xl p-0"
        >
          <Details
            id={pipeline.id}
            type={type}
            onClose={closeDetailsModal}
            onApplyTemplate={handleUseTemplate}
          />
        </Modal>
      )}
    </div>
  )
}

export default React.memo(TemplateCard)
