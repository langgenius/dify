import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { PipelineTemplate } from '@/models/pipeline'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { useInvalidCustomizedTemplateList, useUpdateTemplateInfo } from '@/service/use-pipeline'

type EditPipelineInfoProps = {
  onClose: () => void
  pipeline: PipelineTemplate
}

const EditPipelineInfo = ({
  onClose,
  pipeline,
}: EditPipelineInfoProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(pipeline.name)
  const iconInfo = pipeline.icon
  const [appIcon, setAppIcon] = useState<AppIconSelection>(
    iconInfo.icon_type === 'image'
      ? { type: 'image' as const, url: iconInfo.icon_url || '', fileId: iconInfo.icon || '' }
      : { type: 'emoji' as const, icon: iconInfo.icon || '', background: iconInfo.icon_background || '' },
  )
  const [description, setDescription] = useState(pipeline.description)
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const previousAppIcon = useRef<AppIconSelection>(
    iconInfo.icon_type === 'image'
      ? { type: 'image' as const, url: iconInfo.icon_url || '', fileId: iconInfo.icon || '' }
      : { type: 'emoji' as const, icon: iconInfo.icon || '', background: iconInfo.icon_background || '' },
  )

  const handleAppNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setName(value)
  }, [])

  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
    previousAppIcon.current = appIcon
  }, [appIcon])

  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    setAppIcon(icon)
    setShowAppIconPicker(false)
  }, [])

  const handleCloseAppIconPicker = useCallback(() => {
    setAppIcon(previousAppIcon.current)
    setShowAppIconPicker(false)
  }, [])

  const handleDescriptionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setDescription(value)
  }, [])

  const { mutateAsync: updatePipeline } = useUpdateTemplateInfo()
  const invalidCustomizedTemplateList = useInvalidCustomizedTemplateList()

  const handleSave = useCallback(async () => {
    if (!name) {
      Toast.notify({
        type: 'error',
        message: 'Please enter a name for the Knowledge Base.',
      })
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
  }, [name, appIcon, description, pipeline.id, updatePipeline, invalidCustomizedTemplateList, onClose])

  return (
    <div className="relative flex flex-col">
      {/* Header */}
      <div className="pb-3 pl-6 pr-14 pt-6">
        <span className="title-2xl-semi-bold text-text-primary">
          {t('editPipelineInfo', { ns: 'datasetPipeline' })}
        </span>
      </div>
      <button
        type="button"
        className="absolute right-5 top-5 flex size-8 items-center justify-center"
        onClick={onClose}
      >
        <RiCloseLine className="size-5 text-text-tertiary" />
      </button>
      {/* Form */}
      <div className="flex flex-col gap-y-5 px-6 py-3">
        <div className="flex items-end gap-x-3 self-stretch">
          <div className="flex grow flex-col gap-y-1 pb-1">
            <label className="system-sm-medium flex h-6 items-center text-text-secondary">
              {t('pipelineNameAndIcon', { ns: 'datasetPipeline' })}
            </label>
            <Input
              onChange={handleAppNameChange}
              value={name}
              placeholder={t('knowledgeNameAndIconPlaceholder', { ns: 'datasetPipeline' })}
            />
          </div>
          <AppIcon
            size="xxl"
            onClick={handleOpenAppIconPicker}
            className="cursor-pointer"
            iconType={appIcon.type}
            icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
            background={appIcon.type === 'image' ? undefined : appIcon.background}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            showEditIcon
          />
        </div>
        <div className="flex flex-col gap-y-1">
          <label className="system-sm-medium flex h-6 items-center text-text-secondary">
            {t('knowledgeDescription', { ns: 'datasetPipeline' })}
          </label>
          <Textarea
            onChange={handleDescriptionChange}
            value={description}
            placeholder={t('knowledgeDescriptionPlaceholder', { ns: 'datasetPipeline' })}
          />
        </div>
      </div>
      {/* Actions */}
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <Button
          variant="secondary"
          onClick={onClose}
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={handleSelectAppIcon}
          onClose={handleCloseAppIconPicker}
        />
      )}
    </div>
  )
}

export default React.memo(EditPipelineInfo)
