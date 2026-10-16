import type { IconPickerValue } from '@/app/components/base/icon-picker'
import type { PipelineTemplate } from '@/models/pipeline'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

type EditPipelineInfoProps = {
  onClose: () => void
  pipeline: PipelineTemplate
}

const EditPipelineInfo = ({ onClose, pipeline }: EditPipelineInfoProps) => {
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

  const queryClient = useQueryClient()
  const { mutateAsync: updatePipeline } = useMutation(
    consoleQuery.rag.pipeline.customized.templates.byTemplateId.patch.mutationOptions(),
  )

  const handleSave = useCallback(async () => {
    if (!name) {
      toast.error(t(($) => $.editPipelineInfoNameRequired, { ns: 'datasetPipeline' }))
      return
    }
    const body = {
      name,
      icon_info: {
        icon_type: appIcon.type,
        icon: appIcon.type === 'image' ? appIcon.fileId : appIcon.icon,
        icon_background: appIcon.type === 'image' ? undefined : appIcon.background,
        icon_url: appIcon.type === 'image' ? appIcon.url : undefined,
      },
      description,
    }
    await updatePipeline(
      { params: { template_id: pipeline.id }, body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: consoleQuery.rag.pipeline.templates.get.queryKey({
              input: { query: { type: 'customized' } },
            }),
          })
          onClose()
        },
      },
    )
  }, [name, appIcon, description, pipeline.id, updatePipeline, queryClient, onClose, t])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $.editPipelineInfo, { ns: 'datasetPipeline' })}</DialogTitle>
        <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>
      <DialogBody className="flex flex-col gap-y-5">
        <div className="flex items-end gap-x-3 self-stretch">
          <Field className="grow pb-1" name="name">
            <FieldLabel>{t(($) => $.pipelineNameAndIcon, { ns: 'datasetPipeline' })}</FieldLabel>
            <Input
              autoComplete="off"
              onChange={handleAppNameChange}
              value={name}
              placeholder={t(($) => $.knowledgeNameAndIconPlaceholder, { ns: 'datasetPipeline' })}
            />
          </Field>
          <IconPicker value={appIcon} onValueChange={handleSelectAppIcon}>
            <IconPickerTrigger
              aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $.pipelineNameAndIcon, { ns: 'datasetPipeline' })}`}
              className="group/edit-icon relative shrink-0 cursor-pointer rounded-2xl"
            >
              <IconPickerIcon size="xxl" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 hidden items-center justify-center rounded-[inherit] bg-background-overlay-alt group-hover/edit-icon:flex group-focus-visible/edit-icon:flex"
              >
                <span className="i-ri-edit-line size-8 text-text-primary-on-surface" />
              </span>
            </IconPickerTrigger>
            <IconPickerContent />
          </IconPicker>
        </div>
        <Field name="description">
          <FieldLabel>{t(($) => $.knowledgeDescription, { ns: 'datasetPipeline' })}</FieldLabel>
          <Textarea
            autoComplete="off"
            onValueChange={handleDescriptionChange}
            value={description}
            placeholder={t(($) => $.knowledgeDescriptionPlaceholder, { ns: 'datasetPipeline' })}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button type="submit" variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </form>
  )
}

export default React.memo(EditPipelineInfo)
