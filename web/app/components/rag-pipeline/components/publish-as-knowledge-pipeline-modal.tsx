'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { IconInfo } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { RiCloseLine } from '@remixicon/react'
import { useCallback, useState } from 'react'
import { useTranslation } from '#i18n'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Input from '@/app/components/base/input'
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
  }, [])

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
      <Dialog open>
        <DialogContent className="w-full max-w-[480px]! overflow-hidden! border-none p-0! text-left align-middle">

          <div className="relative flex items-center p-6 pr-14 pb-3 title-2xl-semi-bold text-text-primary">
            {t('common.publishAs', { ns: 'pipeline' })}
            <button
              type="button"
              aria-label={t('operation.close', { ns: 'common' })}
              className="absolute top-5 right-5 flex size-8 cursor-pointer items-center justify-center border-none bg-transparent p-0"
              onClick={onCancel}
            >
              <RiCloseLine className="size-4 text-text-tertiary" aria-hidden="true" />
            </button>
          </div>
          <div className="px-6 py-3">
            <div className="mb-5 flex">
              <div className="mr-3 grow">
                <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
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
              <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                {t('common.publishAsPipeline.description', { ns: 'pipeline' })}
              </div>
              <Textarea
                className="resize-none"
                aria-label={t('common.publishAsPipeline.description', { ns: 'pipeline' })}
                placeholder={t('common.publishAsPipeline.descriptionPlaceholder', { ns: 'pipeline' }) || ''}
                value={description}
                onValueChange={value => setDescription(value)}
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
          {showAppIconPicker && (
            <AppIconPicker
              open={showAppIconPicker}
              initialEmoji={pipelineIcon.icon_type === 'emoji'
                ? { icon: pipelineIcon.icon, background: pipelineIcon.icon_background }
                : undefined}
              onOpenChange={setShowAppIconPicker}
              onSelect={handleSelectIcon}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default PublishAsKnowledgePipelineModal
