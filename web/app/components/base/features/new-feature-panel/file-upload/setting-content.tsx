import React, { useCallback, useMemo, useState } from 'react'
import { produce } from 'immer'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { UploadFileSetting } from '@/app/components/workflow/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'

type SettingContentProps = {
  imageUpload?: boolean
  onClose: () => void
  onChange?: OnFeaturesChange
}
const SettingContent = ({
  imageUpload,
  onClose,
  onChange,
}: SettingContentProps) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const file = useFeatures(state => state.features.file)
  const fileSettingPayload = useMemo(() => {
    return {
      allowed_file_upload_methods: file?.allowed_file_upload_methods || ['local_file', 'remote_url'],
      allowed_file_types: file?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: file?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image],
      max_length: file?.number_limits || 3,
    } as UploadFileSetting
  }, [file])
  const [tempPayload, setTempPayload] = useState<UploadFileSetting>(fileSettingPayload)

  const handleChange = useCallback(() => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft.file = {
        ...draft.file,
        allowed_file_upload_methods: tempPayload.allowed_file_upload_methods,
        number_limits: tempPayload.max_length,
        allowed_file_types: tempPayload.allowed_file_types,
        allowed_file_extensions: tempPayload.allowed_file_extensions,
      }
    })

    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }, [featuresStore, onChange, tempPayload])

  return (
    <>
      <div className='mb-4 flex items-center justify-between'>
        <div className='system-xl-semibold text-text-primary'>{!imageUpload ? t('appDebug.feature.fileUpload.modalTitle') : t('appDebug.feature.imageUpload.modalTitle')}</div>
        <div className='cursor-pointer p-1' onClick={onClose}><RiCloseLine className='h-4 w-4 text-text-tertiary'/></div>
      </div>
      <FileUploadSetting
        isMultiple
        inFeaturePanel
        hideSupportFileType={imageUpload}
        payload={tempPayload}
        onChange={(p: UploadFileSetting) => setTempPayload(p)}
      />
      <div className='mt-4 flex items-center justify-end'>
        <Button
          onClick={onClose}
          className='mr-2'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          onClick={handleChange}
          disabled={tempPayload.allowed_file_types.length === 0}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </>
  )
}

export default React.memo(SettingContent)
