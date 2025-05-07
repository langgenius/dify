import AppIcon from '@/app/components/base/app-icon'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { RiCloseLine } from '@remixicon/react'
import React, { useCallback, useRef, useState } from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import type { PipelineTemple } from '@/models/pipeline'

type EditPipelineInfoProps = {
  onClose: () => void
  onSave: () => void
  pipeline: PipelineTemple
}

const EditPipelineInfo = ({
  onClose,
  onSave,
  pipeline,
}: EditPipelineInfoProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(pipeline.name)
  const iconInfo = pipeline.icon_info
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

  const handleSave = useCallback(() => {
    if (!name) {
      Toast.notify({
        type: 'error',
        message: 'Please enter a name for the Knowledge Base.',
      })
      return
    }
    onSave()
    onClose()
  }, [name, onSave, onClose])

  return (
    <div className='relative flex flex-col'>
      {/* Header */}
      <div className='pb-3 pl-6 pr-14 pt-6'>
        <span className='title-2xl-semi-bold text-text-primary'>
          Edit Pipeline Info
        </span>
      </div>
      <button
        className='absolute right-5 top-5 flex size-8 items-center justify-center'
        onClick={onClose}
      >
        <RiCloseLine className='size-5 text-text-tertiary' />
      </button>
      {/* Form */}
      <div className='flex flex-col gap-y-5 px-6 py-3'>
        <div className='flex items-end gap-x-3 self-stretch'>
          <div className='flex grow flex-col gap-y-1 pb-1'>
            <label className='system-sm-medium flex h-6 items-center text-text-secondary'>Pipeline name & icon</label>
            <Input
              onChange={handleAppNameChange}
              value={name}
              placeholder='Please enter the name of the Knowledge Base'
            />
          </div>
          <AppIcon
            size='xxl'
            onClick={handleOpenAppIconPicker}
            className='cursor-pointer'
            iconType={appIcon.type}
            icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
            background={appIcon.type === 'image' ? undefined : appIcon.background}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            showEditIcon
          />
        </div>
        <div className='flex flex-col gap-y-1'>
          <label className='system-sm-medium flex h-6 items-center text-text-secondary'>Knowledge description</label>
          <Textarea
            onChange={handleDescriptionChange}
            value={description}
            placeholder='Describe what is in this Knowledge Base. A detailed description allows AI to access the content of the dataset more accurately. If empty, Dify will use the default hit strategy. (Optional)'
          />
        </div>
      </div>
      {/* Actions */}
      <div className='flex items-center justify-end gap-x-2 p-6 pt-5'>
        <Button
          variant='secondary'
          onClick={onClose}
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          onClick={handleSave}
        >
          {t('common.operation.save')}
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
