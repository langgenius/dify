'use client'
import type { IconPickerValue } from '@/app/components/base/icon-picker'
import type { IconInfo } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import { useWorkflowStore } from '@/app/components/workflow/store'

type PublishAsKnowledgePipelineModalProps = {
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: (name: string, icon: IconInfo, description?: string) => Promise<void>
}
const PublishAsKnowledgePipelineModal = ({
  confirmDisabled,
  onCancel,
  onConfirm,
}: PublishAsKnowledgePipelineModalProps) => {
  const { t } = useTranslation(['common', 'pipeline', 'workflow'])
  const workflowStore = useWorkflowStore()
  const [pipelineName, setPipelineName] = useState(() => workflowStore.getState().knowledgeName!)
  const [pipelineIcon, setPipelineIcon] = useState(() => workflowStore.getState().knowledgeIcon!)
  const [description, setDescription] = useState('')

  const handleSelectIcon = useCallback((item: IconPickerValue) => {
    if (item.type === 'image') {
      setPipelineIcon({
        icon_type: 'image',
        icon_url: item.url,
        icon_background: '',
        icon: item.fileId,
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
    const name = pipelineName?.trim()
    if (!name || confirmDisabled) return

    onConfirm(name, pipelineIcon, description?.trim())
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="w-full max-w-120">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleConfirm()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t(($) => $['common.publishAs'], { ns: 'pipeline' })}</DialogTitle>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>
          <DialogBody>
            <div className="mb-5 flex">
              <Field className="mr-3 grow" name="name">
                <FieldLabel>
                  {t(($) => $['common.publishAsPipeline.name'], { ns: 'pipeline' })}
                </FieldLabel>
                <Input
                  autoComplete="off"
                  value={pipelineName}
                  onChange={(e) => setPipelineName(e.target.value)}
                  placeholder={
                    t(($) => $['common.publishAsPipeline.namePlaceholder'], { ns: 'pipeline' }) ||
                    ''
                  }
                />
              </Field>
              <IconPicker
                value={
                  pipelineIcon.icon_type === 'emoji'
                    ? {
                        type: 'emoji',
                        icon: pipelineIcon.icon,
                        background: pipelineIcon.icon_background,
                      }
                    : {
                        type: 'image',
                        fileId: pipelineIcon.icon,
                        url: pipelineIcon.icon_url || '',
                      }
                }
                onValueChange={handleSelectIcon}
              >
                <IconPickerTrigger
                  aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $['common.publishAsPipeline.name'], { ns: 'pipeline' })}`}
                  className="mt-2 shrink-0 cursor-pointer rounded-2xl"
                >
                  <IconPickerIcon size="xxl" />
                </IconPickerTrigger>
                <IconPickerContent />
              </IconPicker>
            </div>
            <Field name="description">
              <FieldLabel>
                {t(($) => $['common.publishAsPipeline.description'], { ns: 'pipeline' })}
              </FieldLabel>
              <Textarea
                autoComplete="off"
                className="resize-none"
                placeholder={
                  t(($) => $['common.publishAsPipeline.descriptionPlaceholder'], {
                    ns: 'pipeline',
                  }) || ''
                }
                value={description}
                onValueChange={(value) => setDescription(value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onCancel}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              type="submit"
              disabled={!pipelineName?.trim() || confirmDisabled}
              variant="primary"
            >
              {t(($) => $['common.publish'], { ns: 'workflow' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default PublishAsKnowledgePipelineModal
