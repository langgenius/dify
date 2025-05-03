import React, { useCallback, useState } from 'react'
import type { Pipeline } from '../built-in-pipeline-list'
import AppIcon from '@/app/components/base/app-icon'
import { DOC_FORM_ICON, DOC_FORM_TEXT } from '../../../list/dataset-card'
import { General } from '@/app/components/base/icons/src/public/knowledge'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { RiAddLine, RiArrowRightUpLine, RiMoreFill } from '@remixicon/react'
import CustomPopover from '@/app/components/base/popover'
import Operations from './operations'
import Modal from '@/app/components/base/modal'
import EditPipelineInfo from './edit-pipeline-info'

type TemplateCardProps = {
  pipeline: Pipeline
  showMoreOperations?: boolean
}

const TemplateCard = ({
  pipeline,
  showMoreOperations = true,
}: TemplateCardProps) => {
  const { t } = useTranslation()
  const [showEditModal, setShowEditModal] = useState(false)

  const openEditModal = useCallback(() => {
    setShowEditModal(true)
  }, [])

  const closeEditModal = useCallback(() => {
    setShowEditModal(false)
  }, [])

  const Icon = DOC_FORM_ICON[pipeline.doc_form] || General

  return (
    <div className='group relative flex h-[132px] cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3'>
      <div className='flex items-center gap-x-3 p-4 pb-2'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={pipeline.icon_type}
            icon={pipeline.icon_type === 'image' ? pipeline.file_id : pipeline.icon}
            background={pipeline.icon_type === 'image' ? undefined : pipeline.icon_background}
            imageUrl={pipeline.icon_type === 'image' ? pipeline.url : undefined}
          />
          <div className='absolute -bottom-1 -right-1 z-10'>
            <Icon className='size-4' />
          </div>
        </div>
        <div className='flex grow flex-col gap-y-1 py-px'>
          <div className='system-md-semibold truncate text-text-secondary' title={pipeline.name}>{pipeline.name}</div>
          <div className='system-2xs-medium-uppercase text-text-tertiary'>
            {t(`dataset.chunkingMode.${DOC_FORM_TEXT[pipeline.doc_form]}`)}
          </div>
        </div>
      </div>
      <p className='system-xs-regular line-clamp-3 grow px-4 py-1 text-text-tertiary' title={pipeline.description}>
        {pipeline.description}
      </p>
      <div className='absolute bottom-0 left-0 z-10 hidden w-full items-center gap-x-1 bg-pipeline-template-card-hover-bg p-4 pt-8 group-hover:flex'>
        <Button
          variant='primary'
          onClick={() => {
            console.log('Choose', pipeline)
          }}
          className='grow gap-x-0.5'
        >
          <RiAddLine className='size-4' />
          <span className='px-0.5'>Choose</span>
        </Button>
        <Button
          variant='secondary'
          onClick={() => {
            console.log('details', pipeline)
          }}
          className='grow gap-x-0.5'
        >
          <RiArrowRightUpLine className='size-4' />
          <span className='px-0.5'>Details</span>
        </Button>
        {
          showMoreOperations && (
            <CustomPopover
              htmlContent={
                <Operations
                  openEditModal={openEditModal}
                  onDelete={() => {
                    console.log('Delete', pipeline)
                  }}
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
      <Modal
        isShow={showEditModal}
        onClose={closeEditModal}
        className='max-w-[520px] p-0'
      >
        <EditPipelineInfo
          pipeline={pipeline}
          onClose={closeEditModal}
          onSave={() => {
            console.log('Save', pipeline)
          }}
        />
      </Modal>
    </div>
  )
}

export default React.memo(TemplateCard)
