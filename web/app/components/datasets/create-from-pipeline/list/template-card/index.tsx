import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import EditPipelineInfo from './edit-pipeline-info'
import type { PipelineTemplate } from '@/models/pipeline'
import Confirm from '@/app/components/base/confirm'
import {
  PipelineTemplateListQueryKeyPrefix,
  useDeleteTemplate,
  useExportTemplateDSL,
  usePipelineTemplateById,
} from '@/service/use-pipeline'
import { downloadFile } from '@/utils/format'
import Toast from '@/app/components/base/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useRouter } from 'next/navigation'
import Details from './details'
import Content from './content'
import Actions from './actions'
import type { CreateDatasetReq } from '@/models/datasets'
import { useCreatePipelineDataset } from '@/service/knowledge/use-create-dataset'
import CreateModal from './create-modal'
import { useInvalid } from '@/service/use-base'

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
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { refetch: getPipelineTemplateInfo } = usePipelineTemplateById({
    template_id: pipeline.id,
    type,
  }, false)
  const { mutateAsync: createEmptyDataset } = useCreatePipelineDataset()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const openCreateModal = useCallback(() => {
    setShowCreateModal(true)
  }, [])

  const handleUseTemplate = useCallback(async (payload: Omit<CreateDatasetReq, 'yaml_content'>) => {
    try {
      const { data: pipelineTemplateInfo } = await getPipelineTemplateInfo()
      if (!pipelineTemplateInfo) {
        Toast.notify({
          type: 'error',
          message: t('datasetPipeline.creation.errorTip'),
        })
        return
      }
      const request = {
        ...payload,
        yaml_content: pipelineTemplateInfo.export_data,
      }
      const newDataset = await createEmptyDataset(request)
      Toast.notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      if (newDataset.pipeline_id)
        await handleCheckPluginDependencies(newDataset.pipeline_id, true)
      push(`dataset/${newDataset.id}/pipeline`)
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('datasetPipeline.creation.errorTip'),
      })
    }
  }, [getPipelineTemplateInfo, createEmptyDataset, t, handleCheckPluginDependencies, push])

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
          fileName: `${pipeline.name}.dsl`,
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
  const invalidCustomizedTemplateList = useInvalid([...PipelineTemplateListQueryKeyPrefix, 'customized'])

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
        onApplyTemplate={openCreateModal}
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
          className='h-[calc(100vh-64px)] max-w-[1680px] p-0'
        >
          <Details
            id={pipeline.id}
            type={type}
            onClose={closeDetailsModal}
            onApplyTemplate={openCreateModal}
          />
        </Modal>
      )}
      {showCreateModal && (
        <CreateModal
          show={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleUseTemplate}
        />
      )
      }
    </div>
  )
}

export default React.memo(TemplateCard)
