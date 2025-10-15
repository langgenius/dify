import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import EditPipelineInfo from './edit-pipeline-info'
import type { PipelineTemplate } from '@/models/pipeline'
import Confirm from '@/app/components/base/confirm'
import {
  useDeleteTemplate,
  useExportTemplateDSL,
  useInvalidCustomizedTemplateList,
  usePipelineTemplateById,
} from '@/service/use-pipeline'
import { downloadFile } from '@/utils/format'
import Toast from '@/app/components/base/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useRouter } from 'next/navigation'
import Details from './details'
import Content from './content'
import Actions from './actions'
import { useCreatePipelineDatasetFromCustomized } from '@/service/knowledge/use-create-dataset'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'

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
        message: t('datasetPipeline.creation.errorTip'),
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
          message: t('datasetPipeline.creation.successTip'),
        })
        invalidDatasetList()
        if (newDataset.pipeline_id)
          await handleCheckPluginDependencies(newDataset.pipeline_id, true)
        push(`/datasets/${newDataset.dataset_id}/pipeline`)
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('datasetPipeline.creation.errorTip'),
        })
      },
    })
  }, [getPipelineTemplateInfo, createDataset, t, handleCheckPluginDependencies, push, invalidDatasetList])

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
    if (isExporting) return
    await exportPipelineDSL(pipeline.id, {
      onSuccess: (res) => {
        const blob = new Blob([res.data], { type: 'application/yaml' })
        downloadFile({
          data: blob,
          fileName: `${pipeline.name}.pipeline`,
        })
        Toast.notify({
          type: 'success',
          message: t('datasetPipeline.exportDSL.successTip'),
        })
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('datasetPipeline.exportDSL.errorTip'),
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
    <div className='group relative flex h-[132px] cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3'>
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
          className='max-w-[520px] p-0'
        >
          <EditPipelineInfo
            pipeline={pipeline}
            onClose={closeEditModal}
          />
        </Modal>
      )}
      {showDeleteConfirm && (
        <Confirm
          title={t('datasetPipeline.deletePipeline.title')}
          content={t('datasetPipeline.deletePipeline.content')}
          isShow={showDeleteConfirm}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}
      {showDetailModal && (
        <Modal
          isShow={showDetailModal}
          onClose={closeDetailsModal}
          className='h-[calc(100vh-64px)] max-w-[1680px] rounded-3xl p-0'
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
