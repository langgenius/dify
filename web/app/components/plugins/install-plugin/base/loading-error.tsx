'use client'
import type { FC } from 'react'
import React from 'react'
import { Group } from '../../../base/icons/src/vender/other'
import { LoadingPlaceholder } from '@/app/components/plugins/card/base/placeholder'
import Checkbox from '@/app/components/base/checkbox'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const LoadingError: FC = () => {
  const { t } = useTranslation()
  return (
    <div className='flex items-center space-x-2'>
      <Checkbox
        className='shrink-0'
        checked={false}
        disabled
      />
      <div className='grow relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs'>
        <div className="flex">
          <div
            className='relative flex w-10 h-10 p-1 justify-center items-center gap-2 rounded-[10px]
              border-[0.5px] border-state-destructive-border bg-state-destructive-hover backdrop-blur-sm'>
            <div className='flex w-5 h-5 justify-center items-center'>
              <Group className='text-text-quaternary' />
            </div>
            <div className='absolute bottom-[-4px] right-[-4px] rounded-full border-[2px] border-components-panel-bg bg-state-destructive-solid'>
              <RiCloseLine className='w-3 h-3 text-text-primary-on-surface' />
            </div>
          </div>
          <div className="ml-3 grow">
            <div className="flex items-center h-5 system-md-semibold text-text-destructive">
              {t('plugin.installModal.pluginLoadError')}
            </div>
            <div className='mt-0.5 system-xs-regular text-text-tertiary'>
              {t('plugin.installModal.pluginLoadErrorDesc')}
            </div>
          </div>
        </div>
        <LoadingPlaceholder className="mt-3 w-[420px]" />
      </div>
    </div>
  )
}
export default React.memo(LoadingError)
