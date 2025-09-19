'use client'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import AppIcon from '@/app/components/base/app-icon'
import { noop } from 'lodash-es'
import { useStore } from '@/app/components/workflow/store'
import type { IconInfo } from '@/models/datasets'

type PublishAsKnowledgePipelineModalProps = {
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: (
    name: string,
    icon: IconInfo,
    description?: string,
  ) => Promise<void>
}
const PublishAsKnowledgePipelineModal = ({
  confirmDisabled,
  onCancel,
  onConfirm,
}: PublishAsKnowledgePipelineModalProps) => {
  const { t } = useTranslation()
  const knowledgeName = useStore(s => s.knowledgeName)
  const knowledgeIcon = useStore(s => s.knowledgeIcon)
  const [pipelineName, setPipelineName] = useState(knowledgeName!)
  const [pipelineIcon, setPipelineIcon] = useState(knowledgeIcon!)
  const [description, setDescription] = useState('')
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)

  const handleSelectIcon = useCallback((item: AppIconSelection) => {
    if (item.type === 'image') {
      setPipelineIcon({
        icon_type: 'image',
        icon_url: item.url,
        icon_background: '',
        icon: '',
      })
    }

    if (item.type === 'emoji') {
      setPipelineIcon({
        icon_type: 'emoji',
        icon: item.icon,
        icon_background: item.background,
        icon_url: '',
      })
    }
    setShowAppIconPicker(false)
  }, [])
  const handleCloseIconPicker = useCallback(() => {
    setPipelineIcon({
      icon_type: pipelineIcon.icon_type,
      icon: pipelineIcon.icon,
      icon_background: pipelineIcon.icon_background,
      icon_url: pipelineIcon.icon_url,
    })
    setShowAppIconPicker(false)
  }, [pipelineIcon])

  const handleConfirm = () => {
    if (confirmDisabled)
      return

    onConfirm(
      pipelineName?.trim() || '',
      pipelineIcon,
      description?.trim(),
    )
  }

  return (
    <>
      <Modal
        isShow
        onClose={noop}
        className='relative !w-[520px] !p-0'
      >
        <div className='title-2xl-semi-bold relative flex items-center p-6 pb-3 pr-14 text-text-primary'>
          {t('pipeline.common.publishAs')}
          <div className='absolute right-5 top-5 flex h-8 w-8 cursor-pointer items-center justify-center' onClick={onCancel}>
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
        <div className='px-6 py-3'>
          <div className='mb-5 flex'>
            <div className='mr-3 grow'>
              <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>
                {t('pipeline.common.publishAsPipeline.name')}
              </div>
              <Input
                value={pipelineName}
                onChange={e => setPipelineName(e.target.value)}
                placeholder={t('pipeline.common.publishAsPipeline.namePlaceholder') || ''}
              />
            </div>
            <AppIcon
              size='xxl'
              onClick={() => { setShowAppIconPicker(true) }}
              className='mt-2 shrink-0 cursor-pointer'
              iconType={pipelineIcon?.icon_type}
              icon={pipelineIcon?.icon}
              background={pipelineIcon?.icon_background}
              imageUrl={pipelineIcon?.icon_url}
            />
          </div>
          <div>
            <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary '>
              {t('pipeline.common.publishAsPipeline.description')}
            </div>
            <Textarea
              className='resize-none'
              placeholder={t('pipeline.common.publishAsPipeline.descriptionPlaceholder') || ''}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className='flex items-center justify-end px-6 py-5'>
          <Button
            className='mr-2'
            onClick={onCancel}
          >
            {t('common.operation.cancel')}
          </Button>
          <Button
            disabled={!pipelineName?.trim() || confirmDisabled}
            variant='primary'
            onClick={() => handleConfirm()}
          >
            {t('workflow.common.publish')}
          </Button>
        </div>
      </Modal>
      {showAppIconPicker && <AppIconPicker
        onSelect={handleSelectIcon}
        onClose={handleCloseIconPicker}
      />}
    </>
  )
}

export default PublishAsKnowledgePipelineModal
