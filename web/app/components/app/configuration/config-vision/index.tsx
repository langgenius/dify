'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '../base/feature-panel'
import ParamConfig from './param-config'
import RadioGroup from './radio-group'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import { Eye } from '@/app/components/base/icons/src/vender/solid/general'
import { Resolution, TransferMethod } from '@/types/app'
import ParamItem from '@/app/components/base/param-item'

const ConfigVision: FC = () => {
  const { t } = useTranslation()
  const isShowVision = true
  const [disabled, setDisabled] = useState(false)

  if (!isShowVision)
    return null

  return (<>
    <div>
      <div>
        <div className='leading-6 text-base font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.title')}</div>
        <div className='space-y-6'>
          <div>
            <div className='mb-2 flex space-x-1'>
              <div className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.resolution')}</div>
              <Tooltip htmlContent={<div className='w-[180px]' >
                {t('appDebug.vision.visionSettings.resolutionTooltip')}
              </div>} selector='config-vision-tooltip'>
                <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
              </Tooltip>
            </div>
            <RadioGroup
              className='space-x-3'
              options={[
                {
                  label: t('appDebug.vision.visionSettings.high'),
                  value: Resolution.high,
                },
                {
                  label: t('appDebug.vision.visionSettings.low'),
                  value: Resolution.low,
                },
              ]}
              value={'high'}
              onChange={() => {}}
            />
          </div>
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
                  value: TransferMethod.upload_file,
                },
                {
                  label: t('appDebug.vision.visionSettings.url'),
                  value: TransferMethod.remote_url,
                },
              ]}
              value={'both'}
              onChange={() => {}}
            />
          </div>
          <div>
            <ParamItem
              id='upload_limit'
              className={''}
              name={t('appDebug.vision.visionSettings.uploadLimit')}
              noTooltip
              {...{
                default: 2,
                step: 1,
                min: 1,
                max: 6,
              }}
              value={2}
              enable={true}
              onChange={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
    <Panel
      className="mt-4"
      headerIcon={
        <Eye className='w-4 h-4 text-[#6938EF]'/>
      }
      title={
        <div className='flex items-center'>
          <div className='ml-1 mr-1'>{t('appDebug.vision.name')}</div>
          <Tooltip htmlContent={<div className='w-[180px]' >
            {t('appDebug.vision.description')}
          </div>} selector='config-vision-tooltip'>
            <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
          </Tooltip>
        </div>
      }
      headerRight={
        <div className='flex items-center'>
          <ParamConfig />
          <div className='ml-4 mr-3 w-[1px] h-3.5 bg-gray-200'></div>
          <Switch
            defaultValue={disabled}
            onChange={setDisabled}
            size='md'
          />
        </div>
      }
      noBodySpacing
    />
  </>
  )
}
export default React.memo(ConfigVision)
