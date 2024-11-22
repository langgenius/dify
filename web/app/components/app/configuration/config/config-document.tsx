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
    <div className='mt-2 flex items-center gap-2 p-2 rounded-xl border-t-[0.5px] border-l-[0.5px] bg-background-section-burn'>
      <div className='shrink-0 p-1'>
        <div className='p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600'>
          <Document className='w-4 h-4 text-text-primary-on-surface' />
        </div>
      </div>
      <div className='grow flex items-center'>
        <div className='mr-1 text-text-secondary system-sm-semibold'>{t('appDebug.feature.documentUpload.title')}</div>
        <Tooltip
          popupContent={
            <div className='w-[180px]' >
              {t('appDebug.feature.documentUpload.description')}
            </div>
          }
        />
      </div>
      <div className='shrink-0 flex items-center'>
        <div className='ml-1 mr-3 w-[1px] h-3.5 bg-divider-subtle'></div>
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
