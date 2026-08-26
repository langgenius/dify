'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { IconInfo } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
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
      <DialogContent className="w-full max-w-120! overflow-hidden! border-none p-0! text-left align-middle">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleConfirm()
          }}
        >
          <div className="relative flex items-center p-6 pr-14 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['common.publishAs'], { ns: 'pipeline' })}
            </DialogTitle>
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute top-5 right-5"
              onClick={onCancel}
            >
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
          </div>
          <div className="px-6 py-3">
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
              <button
                type="button"
                aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $['common.publishAsPipeline.name'], { ns: 'pipeline' })}`}
                onClick={() => {
                  setShowAppIconPicker(true)
                }}
                className="mt-2 shrink-0 cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                <AppIcon
                  size="xxl"
                  iconType={pipelineIcon?.icon_type}
                  icon={pipelineIcon?.icon}
                  background={pipelineIcon?.icon_background}
                  imageUrl={pipelineIcon?.icon_url}
                />
              </button>
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
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-5">
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
          </div>
          {showAppIconPicker && (
            <AppIconPicker
              open={showAppIconPicker}
              initialEmoji={
                pipelineIcon.icon_type === 'emoji'
                  ? { icon: pipelineIcon.icon, background: pipelineIcon.icon_background }
                  : undefined
              }
              onOpenChange={setShowAppIconPicker}
              onSelect={handleSelectIcon}
            />
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default PublishAsKnowledgePipelineModal
