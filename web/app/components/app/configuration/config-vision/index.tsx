'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '../base/feature-panel'
import { HelpCircle, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import { Eye } from '@/app/components/base/icons/src/vender/solid/general'

const ConfigVision: FC = () => {
  const { t } = useTranslation()
  const isShowVision = true
  const [disabled, setDisabled] = useState(false)

  if (!isShowVision)
    return null

  return (
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
          <div className='flex items-center'>
            <Settings01 className='w-3.5 h-3.5 text-gray-700' />
            <div className='ml-1 leading-[18px] text-xs font-medium text-gray-700'>{t('appDebug.vision.settings')}</div>
          </div>
          <div className='ml-4 mr-3 w-[1px] h-3.5 bg-gray-200'></div>
          <Switch
            defaultValue={disabled}
            onChange={setDisabled}
            size='md'
          />
        </div>
      }
      noBodySpacing
    >

    </Panel>
  )
}
export default React.memo(ConfigVision)
