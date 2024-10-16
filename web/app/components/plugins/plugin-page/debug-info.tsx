'use client'
import type { FC } from 'react'
import React from 'react'
import {
  RiArrowRightUpLine,
  RiBugLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import KeyValueItem from '../base/key-value-item'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'

const i18nPrefix = 'plugin.debugInfo'

const DebugInfo: FC = () => {
  const { t } = useTranslation()
  return (
    <Tooltip
      triggerMethod='click'
      popupContent={
        <>
          <div className='flex items-center gap-1 self-stretch'>
            <span className='flex flex-col justify-center items-start flex-grow flex-shrink-0 basis-0 text-text-secondary system-sm-semibold'>{t(`${i18nPrefix}.title`)}</span>
            <a href='' target='_blank' className='flex items-center gap-0.5 text-text-accent-light-mode-only cursor-pointer'>
              <span className='system-xs-medium'>{t(`${i18nPrefix}.viewDocs`)}</span>
              <RiArrowRightUpLine className='w-3 h-3' />
            </a>
          </div>
          <div className='space-y-0.5'>
            <KeyValueItem
              label={'Port'}
              value={'cloud.dify,ai:2048'}
            />
            <KeyValueItem
              label={'Key'}
              value={'A1B2C3D4E5F6G7H8'}
            />
          </div>
        </>
      }
      popupClassName='flex flex-col items-start w-[256px] px-4 py-3.5 gap-1 border border-components-panel-border
        rounded-xl bg-components-tooltip-bg shadows-shadow-lg z-50'
      asChild={false}
      position='bottom'
    >
      <Button className='w-full h-full p-2 text-components-button-secondary-text'>
        <RiBugLine className='w-4 h-4' />
      </Button>
    </Tooltip>
  )
}

export default React.memo(DebugInfo)
