import React, { useCallback, useState } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { General } from '@/app/components/base/icons/src/public/knowledge/dataset-card'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { RiAddLine, RiArrowRightUpLine, RiMoreFill } from '@remixicon/react'
import CustomPopover from '@/app/components/base/popover'
import Operations from './operations'
import Modal from '@/app/components/base/modal'
import EditPipelineInfo from './edit-pipeline-info'
import type { PipelineTemple } from '@/models/pipeline'
import { DOC_FORM_ICON, DOC_FORM_TEXT } from '@/models/datasets'
import Confirm from '@/app/components/base/confirm'
import { useDeletePipeline, useExportPipelineDSL, useImportPipelineDSL, usePipelineTemplateById } from '@/service/use-pipeline'
import { downloadFile } from '@/utils/format'
import Toast from '@/app/components/base/toast'
import { DSLImportMode } from '@/models/app'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { useRouter } from 'next/navigation'
import Details from './details'

type TemplateCardProps = {
  pipeline: PipelineTemple
  showMoreOperations?: boolean
}

const TemplateCard = ({
  pipeline,
  showMoreOperations = true,
}: TemplateCardProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowConfirmDelete] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)

  const { refetch: getPipelineTemplateInfo } = usePipelineTemplateById(pipeline.id, false)
  const { mutateAsync: importPipelineDSL } = useImportPipelineDSL()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const handleUseTemplate = useCallback(async () => {
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
        mode: DSLImportMode.YAML_CONTENT,
        name: pipeline.name,
        yaml_content: pipelineTemplateInfo.export_data,
        icon_info: pipeline.icon_info,
        description: pipeline.description,
      }
      const newPipeline = await importPipelineDSL(request)
      Toast.notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      if (newPipeline.dataset_id)
        await handleCheckPluginDependencies(newPipeline.dataset_id) // todo: replace with pipeline dependency check
      push(`dataset/${newPipeline.dataset_id}/pipeline`)
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('datasetPipeline.creation.errorTip'),
      })
    }
  }, [getPipelineTemplateInfo, importPipelineDSL, pipeline, t, push, handleCheckPluginDependencies])

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

  const { mutateAsync: exportPipelineDSL, isPending: isExporting } = useExportPipelineDSL()

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

  const { mutateAsync: deletePipeline } = useDeletePipeline()

  const onConfirmDelete = useCallback(async () => {
    await deletePipeline(pipeline.id, {
      onSettled: () => {
        setShowConfirmDelete(false)
      },
    })
  }, [pipeline.id, deletePipeline])

  const Icon = DOC_FORM_ICON[pipeline.doc_form] || General
  const iconInfo = pipeline.icon_info

  return (
    <div className='group relative flex h-[132px] cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3'>
      <div className='flex items-center gap-x-3 p-4 pb-2'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={iconInfo.icon_type}
            icon={iconInfo.icon}
            background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
            imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
          />
          <div className='absolute -bottom-1 -right-1 z-10'>
            <Icon className='size-4' />
          </div>
        </div>
        <div className='flex grow flex-col gap-y-1 py-px'>
          <div
            className='system-md-semibold truncate text-text-secondary'
            title={pipeline.name}
          >
            {pipeline.name}
          </div>
          <div className='system-2xs-medium-uppercase text-text-tertiary'>
            {t(`dataset.chunkingMode.${DOC_FORM_TEXT[pipeline.doc_form]}`)}
          </div>
        </div>
      </div>
      <p
        className='system-xs-regular line-clamp-3 grow px-4 py-1 text-text-tertiary'
        title={pipeline.description}
      >
        {pipeline.description}
      </p>
      <div className='absolute bottom-0 left-0 z-10 hidden w-full items-center gap-x-1 bg-pipeline-template-card-hover-bg p-4 pt-8 group-hover:flex'>
        <Button
          variant='primary'
          onClick={handleUseTemplate}
          className='grow gap-x-0.5'
        >
          <RiAddLine className='size-4' />
          <span className='px-0.5'>{t('datasetPipeline.operations.choose')}</span>
        </Button>
        <Button
          variant='secondary'
          onClick={handleShowTemplateDetails}
          className='grow gap-x-0.5'
        >
          <RiArrowRightUpLine className='size-4' />
          <span className='px-0.5'>{t('datasetPipeline.operations.details')}</span>
        </Button>
        {
          showMoreOperations && (
            <CustomPopover
              htmlContent={
                <Operations
                  openEditModal={openEditModal}
                  onExport={handleExportDSL}
                  onDelete={handleDelete}
                />
              }
              className={'z-20 min-w-[160px]'}
              popupClassName={'rounded-xl bg-none shadow-none ring-0 min-w-[160px]'}
              position='br'
              trigger='click'
              btnElement={
                <RiMoreFill className='size-4 text-text-tertiary' />
              }
              btnClassName='size-8 cursor-pointer justify-center rounded-lg p-0 shadow-xs shadow-shadow-shadow-3'
            />
          )
        }
      </div>
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
            onClose={closeDetailsModal}
            handleUseTemplate={handleUseTemplate}
          />
        </Modal>
      )}
    </div>
  )
}

export default React.memo(TemplateCard)
