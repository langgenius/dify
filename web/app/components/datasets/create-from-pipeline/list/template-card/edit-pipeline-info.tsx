import type { IconPickerValue } from '@/app/components/base/icon-picker'
import type { PipelineTemplate, UpdateTemplateInfoRequest } from '@/models/pipeline'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
import { toast } from '@/app/notifications'
import { useInvalidCustomizedTemplateList, useUpdateTemplateInfo } from '@/service/use-pipeline'

type EditPipelineInfoProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pipeline: PipelineTemplate
}

type EditPipelineInfoFormProps = {
  pipeline: PipelineTemplate
  isPending: boolean
  onSave: (request: UpdateTemplateInfoRequest) => Promise<void>
}

function EditPipelineInfoForm({ pipeline, isPending, onSave }: EditPipelineInfoFormProps) {
  const { t } = useTranslation(['common', 'datasetPipeline'])
  const [name, setName] = useState(pipeline.name)
  const iconInfo = pipeline.icon
  const [appIcon, setAppIcon] = useState<IconPickerValue>(
    iconInfo.icon_type === 'image'
      ? { type: 'image' as const, url: iconInfo.icon_url || '', fileId: iconInfo.icon || '' }
      : {
          type: 'emoji' as const,
          icon: iconInfo.icon || '',
          background: iconInfo.icon_background || '',
        },
  )
  const [description, setDescription] = useState(pipeline.description)

  const handleAppNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setName(value)
  }, [])

  const handleSelectAppIcon = useCallback((icon: IconPickerValue) => {
    setAppIcon(icon)
  }, [])

  const handleDescriptionChange = useCallback((value: string) => {
    setDescription(value)
  }, [])

  const handleSave = useCallback(async () => {
    if (isPending) return
    if (!name) {
      toast.error(t(($) => $.editPipelineInfoNameRequired, { ns: 'datasetPipeline' }))
      return
    }
    const request = {
      template_id: pipeline.id,
      name,
      icon_info: {
        icon_type: appIcon.type,
        icon: appIcon.type === 'image' ? appIcon.fileId : appIcon.icon,
        icon_background: appIcon.type === 'image' ? undefined : appIcon.background,
        icon_url: appIcon.type === 'image' ? appIcon.url : undefined,
      },
      description,
    }
    await onSave(request)
  }, [name, appIcon, description, pipeline.id, isPending, onSave, t])

  return (
    <form
      className="relative flex flex-col"
      onSubmit={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        event.stopPropagation()
        void handleSave()
      }}
    >
      {/* Header */}
      <div className="pt-6 pr-14 pb-3 pl-6">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $.editPipelineInfo, { ns: 'datasetPipeline' })}
        </DialogTitle>
      </div>
      <DialogClose
        disabled={isPending}
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute top-5 right-5"
          >
            <span aria-hidden="true" className="i-ri-close-line size-5" />
          </IconButton>
        }
      />
      {/* Form */}
      <div className="flex flex-col gap-y-5 px-6 py-3">
        <div className="flex items-end gap-x-3 self-stretch">
          <Field className="grow pb-1" name="name">
            <FieldLabel>{t(($) => $.pipelineNameAndIcon, { ns: 'datasetPipeline' })}</FieldLabel>
            <Input
              readOnly={isPending}
              autoComplete="off"
              onChange={handleAppNameChange}
              value={name}
              placeholder={t(($) => $.knowledgeNameAndIconPlaceholder, { ns: 'datasetPipeline' })}
            />
          </Field>
          <IconPicker value={appIcon} onValueChange={handleSelectAppIcon}>
            <IconPickerTrigger
              disabled={isPending}
              aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $.pipelineNameAndIcon, { ns: 'datasetPipeline' })}`}
              className="group/edit-icon shrink-0 cursor-pointer rounded-2xl"
            >
              <IconPickerIcon size="xxl" showEditIcon />
            </IconPickerTrigger>
            <IconPickerContent />
          </IconPicker>
        </div>
        <Field name="description">
          <FieldLabel>{t(($) => $.knowledgeDescription, { ns: 'datasetPipeline' })}</FieldLabel>
          <Textarea
            readOnly={isPending}
            autoComplete="off"
            onValueChange={handleDescriptionChange}
            value={description}
            placeholder={t(($) => $.knowledgeDescriptionPlaceholder, { ns: 'datasetPipeline' })}
          />
        </Field>
      </div>
      {/* Actions */}
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <DialogClose disabled={isPending} render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" loading={isPending} variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}

export function EditPipelineInfo({ pipeline, open, onOpenChange }: EditPipelineInfoProps) {
  const { mutateAsync: updatePipeline, isPending } = useUpdateTemplateInfo()
  const invalidCustomizedTemplateList = useInvalidCustomizedTemplateList()
  const handleSave = async (request: UpdateTemplateInfoRequest) => {
    if (isPending) return
    try {
      await updatePipeline(request, {
        onSuccess: () => {
          invalidCustomizedTemplateList()
          onOpenChange(false)
        },
      })
    } catch {
      // The service reports the request error; keep the draft available for retry.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (isPending) {
          details.cancel()
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-130! overflow-hidden! border-none p-0 text-left align-middle">
        <EditPipelineInfoForm pipeline={pipeline} isPending={isPending} onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}
