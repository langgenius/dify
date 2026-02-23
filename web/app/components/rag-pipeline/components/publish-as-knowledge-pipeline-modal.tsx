'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { IconInfo } from '@/models/datasets'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import { useWorkflowStore } from '@/app/components/workflow/store'

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
  const workflowStore = useWorkflowStore()
  const [pipelineName, setPipelineName] = useState(() => workflowStore.getState().knowledgeName!)
  const [pipelineIcon, setPipelineIcon] = useState(() => workflowStore.getState().knowledgeIcon!)
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
        className="relative !w-[520px] !p-0"
      >
        <div className="title-2xl-semi-bold relative flex items-center p-6 pb-3 pr-14 text-text-primary">
          {t('common.publishAs', { ns: 'pipeline' })}
          <div
            data-testid="publish-modal-close-btn"
            className="absolute right-5 top-5 flex h-8 w-8 cursor-pointer items-center justify-center"
            onClick={onCancel}
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
        <div className="px-6 py-3">
          <div className="mb-5 flex">
            <div className="mr-3 grow">
              <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">
                {t('common.publishAsPipeline.name', { ns: 'pipeline' })}
              </div>
              <Input
                value={pipelineName}
                onChange={e => setPipelineName(e.target.value)}
                placeholder={t('common.publishAsPipeline.namePlaceholder', { ns: 'pipeline' }) || ''}
              />
            </div>
            <AppIcon
              size="xxl"
              onClick={() => { setShowAppIconPicker(true) }}
              className="mt-2 shrink-0 cursor-pointer"
              iconType={pipelineIcon?.icon_type}
              icon={pipelineIcon?.icon}
              background={pipelineIcon?.icon_background}
              imageUrl={pipelineIcon?.icon_url}
            />
          </div>
          <div>
            <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary ">
              {t('common.publishAsPipeline.description', { ns: 'pipeline' })}
            </div>
            <Textarea
              className="resize-none"
              placeholder={t('common.publishAsPipeline.descriptionPlaceholder', { ns: 'pipeline' }) || ''}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-end px-6 py-5">
          <Button
            className="mr-2"
            onClick={onCancel}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            disabled={!pipelineName?.trim() || confirmDisabled}
            variant="primary"
            onClick={() => handleConfirm()}
          >
            {t('common.publish', { ns: 'workflow' })}
          </Button>
        </div>
      </Modal>
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={handleSelectIcon}
          onClose={handleCloseIconPicker}
        />
      )}
    </>
  )
}

export default PublishAsKnowledgePipelineModal
