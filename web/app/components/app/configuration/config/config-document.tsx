'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useContext } from 'use-context-selector'

import { Document } from '@/app/components/base/icons/src/vender/features'
import Tooltip from '@/app/components/base/tooltip'
import ConfigContext from '@/context/debug-configuration'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import Switch from '@/app/components/base/switch'

const ConfigDocument: FC = () => {
  const { t } = useTranslation()
  const file = useFeatures(s => s.features.file)
  const featuresStore = useFeaturesStore()
  const { isShowDocumentConfig } = useContext(ConfigContext)

  const isDocumentEnabled = file?.allowed_file_types?.includes(SupportUploadFileTypes.document) ?? false

  const handleChange = useCallback((value: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      if (value) {
        draft.file!.allowed_file_types = Array.from(new Set([
          ...(draft.file?.allowed_file_types || []),
          SupportUploadFileTypes.document,
        ]))
      }
      else {
        draft.file!.allowed_file_types = draft.file!.allowed_file_types?.filter(
          type => type !== SupportUploadFileTypes.document,
        )
      }
      if (draft.file)
        draft.file.enabled = (draft.file.allowed_file_types?.length ?? 0) > 0
    })
    setFeatures(newFeatures)
  }, [featuresStore])

  if (!isShowDocumentConfig)
    return null

  return (
    <div className='bg-background-section-burn mt-2 flex items-center gap-2 rounded-xl border-l-[0.5px] border-t-[0.5px] p-2'>
      <div className='shrink-0 p-1'>
        <div className='border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600 rounded-lg border-[0.5px] p-1'>
          <Document className='text-text-primary-on-surface h-4 w-4' />
        </div>
      </div>
      <div className='flex grow items-center'>
        <div className='text-text-secondary system-sm-semibold mr-1'>{t('appDebug.feature.documentUpload.title')}</div>
        <Tooltip
          popupContent={
            <div className='w-[180px]' >
              {t('appDebug.feature.documentUpload.description')}
            </div>
          }
        />
      </div>
      <div className='flex shrink-0 items-center'>
        <div className='bg-divider-subtle ml-1 mr-3 h-3.5 w-[1px]'></div>
        <Switch
          defaultValue={isDocumentEnabled}
          onChange={handleChange}
          size='md'
        />
      </div>
    </div>
  )
}
export default React.memo(ConfigDocument)
