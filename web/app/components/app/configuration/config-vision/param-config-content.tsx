'use client'
import type { FC } from 'react'
import type { FileUpload } from '@/app/components/base/features/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import ParamItem from '@/app/components/base/param-item'
import Tooltip from '@/app/components/base/tooltip'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { Resolution, TransferMethod } from '@/types/app'

const MIN = 1
const MAX = 6
const ParamConfigContent: FC = () => {
  const { t } = useTranslation()
  const file = useFeatures(s => s.features.file)
  const featuresStore = useFeaturesStore()

  const handleChange = useCallback((data: FileUpload) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft.file = {
        ...draft.file,
        allowed_file_upload_methods: data.allowed_file_upload_methods,
        number_limits: data.number_limits,
        image: {
          enabled: data.enabled,
          detail: data.image?.detail,
          transfer_methods: data.allowed_file_upload_methods,
          number_limits: data.number_limits,
        },
      }
    })
    setFeatures(newFeatures)
  }, [featuresStore])

  return (
    <div>
      <div className="text-base font-semibold leading-6 text-text-primary">{t('vision.visionSettings.title', { ns: 'appDebug' })}</div>
      <div className="space-y-6 pt-3">
        <div>
          <div className="mb-2 flex items-center  space-x-1">
            <div className="text-[13px] font-semibold leading-[18px] text-text-secondary">{t('vision.visionSettings.resolution', { ns: 'appDebug' })}</div>
            <Tooltip
              popupContent={(
                <div className="w-[180px]">
                  {t('vision.visionSettings.resolutionTooltip', { ns: 'appDebug' }).split('\n').map(item => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              )}
            />
          </div>
          <div className="flex items-center gap-1">
            <OptionCard
              className="grow"
              title={t('vision.visionSettings.high', { ns: 'appDebug' })}
              selected={file?.image?.detail === Resolution.high}
              onSelect={() => handleChange({
                ...file,
                image: { detail: Resolution.high },
              })}
            />
            <OptionCard
              className="grow"
              title={t('vision.visionSettings.low', { ns: 'appDebug' })}
              selected={file?.image?.detail === Resolution.low}
              onSelect={() => handleChange({
                ...file,
                image: { detail: Resolution.low },
              })}
            />
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold leading-[18px] text-text-secondary">{t('vision.visionSettings.uploadMethod', { ns: 'appDebug' })}</div>
          <div className="flex items-center gap-1">
            <OptionCard
              className="grow"
              title={t('vision.visionSettings.both', { ns: 'appDebug' })}
              selected={!!file?.allowed_file_upload_methods?.includes(TransferMethod.local_file) && !!file?.allowed_file_upload_methods?.includes(TransferMethod.remote_url)}
              onSelect={() => handleChange({
                ...file,
                allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
              })}
            />
            <OptionCard
              className="grow"
              title={t('vision.visionSettings.localUpload', { ns: 'appDebug' })}
              selected={!!file?.allowed_file_upload_methods?.includes(TransferMethod.local_file) && file?.allowed_file_upload_methods?.length === 1}
              onSelect={() => handleChange({
                ...file,
                allowed_file_upload_methods: [TransferMethod.local_file],
              })}
            />
            <OptionCard
              className="grow"
              title={t('vision.visionSettings.url', { ns: 'appDebug' })}
              selected={!!file?.allowed_file_upload_methods?.includes(TransferMethod.remote_url) && file?.allowed_file_upload_methods?.length === 1}
              onSelect={() => handleChange({
                ...file,
                allowed_file_upload_methods: [TransferMethod.remote_url],
              })}
            />
          </div>
        </div>
        <div>
          <ParamItem
            id="upload_limit"
            className=""
            name={t('vision.visionSettings.uploadLimit', { ns: 'appDebug' })}
            noTooltip
            {...{
              default: 2,
              step: 1,
              min: MIN,
              max: MAX,
            }}
            value={file?.number_limits || 3}
            enable={true}
            onChange={(_key: string, value: number) => {
              if (!value)
                return

              handleChange({
                ...file,
                number_limits: value,
              })
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default React.memo(ParamConfigContent)
