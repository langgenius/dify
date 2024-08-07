'use client'
import produce from 'immer'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnFeaturesChange } from '../../types'
import {
  useFeatures,
  useFeaturesStore,
} from '../../hooks'
import ParamConfig from './param-config'
import Switch from '@/app/components/base/switch'
import { File05 } from '@/app/components/base/icons/src/vender/solid/files'

type FileUploadProps = {
  onChange?: OnFeaturesChange
  disabled?: boolean
}
const FileUpload = ({
  onChange,
  disabled,
}: FileUploadProps) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const file = useFeatures(s => s.features.file)

  const handleSwitch = useCallback((value: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.image)
        draft.file.image.enabled = value
    })
    setFeatures(newFeatures)

    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  return (
    <div className='flex items-center px-3 h-12 bg-gray-50 rounded-xl overflow-hidden'>
      <div className='shrink-0 flex items-center justify-center mr-1 w-6 h-6'>
        <File05 className='shrink-0 w-4 h-4 text-[#6938EF]' />
      </div>
      <div className='shrink-0 mr-2 whitespace-nowrap text-sm text-gray-800 font-semibold'>
        {t('common.imageUploader.imageUpload')}
      </div>
      <div className='grow' />
      <div className='flex items-center'>
        <ParamConfig onChange={onChange} disabled={disabled} />
        <div className='ml-4 mr-3 w-[1px] h-3.5 bg-gray-200'></div>
        <Switch
          defaultValue={file?.image?.enabled}
          onChange={handleSwitch}
          disabled={disabled}
          size='md'
        />
      </div>
    </div>
  )
}
export default React.memo(FileUpload)
