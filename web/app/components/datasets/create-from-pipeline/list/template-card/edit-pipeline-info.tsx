import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { PipelineTemplate } from '@/models/pipeline'
import { Button } from '@langgenius/dify-ui/button'
import { DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { useInvalidCustomizedTemplateList, useUpdateTemplateInfo } from '@/service/use-pipeline'

type EditPipelineInfoProps = {
  onClose: () => void
  pipeline: PipelineTemplate
}

const EditPipelineInfo = ({ onClose, pipeline }: EditPipelineInfoProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(pipeline.name)
  const iconInfo = pipeline.icon
  const [appIcon, setAppIcon] = useState<AppIconSelection>(
    iconInfo.icon_type === 'image'
      ? { type: 'image' as const, url: iconInfo.icon_url || '', fileId: iconInfo.icon || '' }
      : {
          type: 'emoji' as const,
          icon: iconInfo.icon || '',
          background: iconInfo.icon_background || '',
        },
  )
  const [description, setDescription] = useState(pipeline.description)
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)

  const handleAppNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setName(value)
  }, [])

  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
  }, [])

  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    setAppIcon(icon)
  }, [])

  const handleDescriptionChange = useCallback((value: string) => {
    setDescription(value)
  }, [])

  const { mutateAsync: updatePipeline } = useUpdateTemplateInfo()
  const invalidCustomizedTemplateList = useInvalidCustomizedTemplateList()

  const handleSave = useCallback(async () => {
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
    await updatePipeline(request, {
      onSuccess: () => {
        invalidCustomizedTemplateList()
        onClose()
      },
    })
  }, [
    name,
    appIcon,
    description,
    pipeline.id,
    updatePipeline,
    invalidCustomizedTemplateList,
    onClose,
    t,
  ])

  return (
    <form
      className="relative flex flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      {/* Header */}
      <div className="pt-6 pr-14 pb-3 pl-6">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $.editPipelineInfo, { ns: 'datasetPipeline' })}
        </DialogTitle>
      </div>
      <IconButton
        aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        size="lg"
        className="absolute top-5 right-5"
        onClick={onClose}
      >
        <span aria-hidden="true" className="i-ri-close-line size-5" />
      </IconButton>
      {/* Form */}
      <div className="flex flex-col gap-y-5 px-6 py-3">
        <div className="flex items-end gap-x-3 self-stretch">
          <Field className="grow pb-1" name="name">
            <FieldLabel className="flex h-6 items-center py-0">
              {t(($) => $.pipelineNameAndIcon, { ns: 'datasetPipeline' })}
            </FieldLabel>
            <Input
              autoComplete="off"
              onChange={handleAppNameChange}
              value={name}
              placeholder={t(($) => $.knowledgeNameAndIconPlaceholder, { ns: 'datasetPipeline' })}
            />
          </Field>
          <button
            type="button"
            aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $.pipelineNameAndIcon, { ns: 'datasetPipeline' })}`}
            onClick={handleOpenAppIconPicker}
            className="shrink-0 cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <AppIcon
              size="xxl"
              iconType={appIcon.type}
              icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
              background={appIcon.type === 'image' ? undefined : appIcon.background}
              imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              showEditIcon
            />
          </button>
        </div>
        <Field name="description">
          <FieldLabel className="flex h-6 items-center py-0">
            {t(($) => $.knowledgeDescription, { ns: 'datasetPipeline' })}
          </FieldLabel>
          <Textarea
            autoComplete="off"
            onValueChange={handleDescriptionChange}
            value={description}
            placeholder={t(($) => $.knowledgeDescriptionPlaceholder, { ns: 'datasetPipeline' })}
          />
        </Field>
      </div>
      {/* Actions */}
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button type="submit" variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
      {showAppIconPicker && (
        <AppIconPicker
          open={showAppIconPicker}
          initialEmoji={
            appIcon.type === 'emoji'
              ? { icon: appIcon.icon, background: appIcon.background }
              : undefined
          }
          onOpenChange={setShowAppIconPicker}
          onSelect={handleSelectAppIcon}
        />
      )}
    </form>
  )
}

export default React.memo(EditPipelineInfo)
