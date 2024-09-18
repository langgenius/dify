'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useContext } from 'use-context-selector'
import ParamConfig from './param-config'
import { Vision } from '@/app/components/base/icons/src/vender/features'
import Tooltip from '@/app/components/base/tooltip'
// import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import ConfigContext from '@/context/debug-configuration'
// import { Resolution } from '@/types/app'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import Switch from '@/app/components/base/switch'
import type { FileUpload } from '@/app/components/base/features/types'

const ConfigVision: FC = () => {
  const { t } = useTranslation()
  const { isShowVisionConfig } = useContext(ConfigContext)
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
        enabled: data.enabled,
        image: {
          enabled: data.enabled,
          detail: data.image?.detail,
          transfer_methods: data.image?.transfer_methods,
          number_limits: data.image?.number_limits,
        },
      }
    })
    setFeatures(newFeatures)
  }, [featuresStore])

  if (!isShowVisionConfig)
    return null

  return (
    <div className='mt-2 flex items-center gap-2 p-2 rounded-xl border-t-[0.5px] border-l-[0.5px] bg-background-section-burn'>
      <div className='shrink-0 p-1'>
        <div className='p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600'>
          <Vision className='w-4 h-4 text-text-primary-on-surface' />
        </div>
      </div>
      <div className='grow flex items-center'>
        <div className='mr-1 text-text-secondary system-sm-semibold'>{t('appDebug.vision.name')}</div>
        <Tooltip
          popupContent={
            <div className='w-[180px]' >
              {t('appDebug.vision.description')}
            </div>
          }
        />
      </div>
      <div className='shrink-0 flex items-center'>
        {/* <div className='mr-2 flex items-center gap-0.5'>
          <div className='text-text-tertiary system-xs-medium-uppercase'>{t('appDebug.vision.visionSettings.resolution')}</div>
          <Tooltip
            popupContent={
              <div className='w-[180px]' >
                {t('appDebug.vision.visionSettings.resolutionTooltip').split('\n').map(item => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            }
          />
        </div> */}
        {/* <div className='flex items-center gap-1'>
          <OptionCard
            title={t('appDebug.vision.visionSettings.high')}
            selected={file?.image?.detail === Resolution.high}
            onSelect={() => handleChange(Resolution.high)}
          />
          <OptionCard
            title={t('appDebug.vision.visionSettings.low')}
            selected={file?.image?.detail === Resolution.low}
            onSelect={() => handleChange(Resolution.low)}
          />
        </div> */}
        <ParamConfig />
        <div className='ml-1 mr-3 w-[1px] h-3.5 bg-divider-subtle'></div>
        <Switch
          defaultValue={file?.enabled}
          onChange={value => handleChange({
            ...(file || {}),
            enabled: value,
          })}
          size='md'
        />
      </div>
    </div>
  )
}
export default React.memo(ConfigVision)
