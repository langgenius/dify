'use client'

import produce from 'immer'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnFeaturesChange } from '../../types'
import {
  useFeatures,
  useFeaturesStore,
} from '../../hooks'
import RadioGroup from './radio-group'
import { TransferMethod } from '@/types/app'
import ParamItem from '@/app/components/base/param-item'

const MIN = 1
const MAX = 6
type ParamConfigContentProps = {
  onChange?: OnFeaturesChange
}
const ParamConfigContent = ({
  onChange,
}: ParamConfigContentProps) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const file = useFeatures(s => s.features.file)

  const transferMethod = useMemo(() => {
    if (!file?.image?.transfer_methods || file?.image.transfer_methods.length === 2)
      return TransferMethod.all

    return file.image.transfer_methods[0]
  }, [file?.image?.transfer_methods])

  const handleTransferMethodsChange = useCallback((value: TransferMethod) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.image) {
        if (value === TransferMethod.all)
          draft.file.image.transfer_methods = [TransferMethod.remote_url, TransferMethod.local_file]
        else
          draft.file.image.transfer_methods = [value]
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleLimitsChange = useCallback((_key: string, value: number) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.image)
        draft.file.image.number_limits = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  return (
    <div>
      <div>
        <div className='leading-6 text-base font-semibold text-gray-800'>{t('common.operation.settings')}</div>
        <div className='pt-3 space-y-6'>
          <div>
            <div className='mb-2 leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.uploadMethod')}</div>
            <RadioGroup
              className='space-x-3'
              options={[
                {
                  label: t('appDebug.vision.visionSettings.both'),
                  value: TransferMethod.all,
                },
                {
                  label: t('appDebug.vision.visionSettings.localUpload'),
                  value: TransferMethod.local_file,
                },
                {
                  label: t('appDebug.vision.visionSettings.url'),
                  value: TransferMethod.remote_url,
                },
              ]}
              value={transferMethod}
              onChange={handleTransferMethodsChange}
            />
          </div>
          <div>
            <ParamItem
              id='upload_limit'
              className=''
              name={t('appDebug.vision.visionSettings.uploadLimit')}
              noTooltip
              {...{
                default: 2,
                step: 1,
                min: MIN,
                max: MAX,
              }}
              value={file?.image?.number_limits || 3}
              enable={true}
              onChange={handleLimitsChange}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(ParamConfigContent)
