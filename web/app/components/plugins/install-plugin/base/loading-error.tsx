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
      <div className='hover-bg-components-panel-on-panel-item-bg relative grow rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs'>
        <div className="flex">
          <div
            className='relative flex h-10 w-10 items-center justify-center gap-2 rounded-[10px] border-[0.5px]
              border-state-destructive-border bg-state-destructive-hover p-1 backdrop-blur-sm'>
            <div className='flex h-5 w-5 items-center justify-center'>
              <Group className='text-text-quaternary' />
            </div>
            <div className='absolute bottom-[-4px] right-[-4px] rounded-full border-[2px] border-components-panel-bg bg-state-destructive-solid'>
              <RiCloseLine className='h-3 w-3 text-text-primary-on-surface' />
            </div>
          </div>
          <div className="ml-3 grow">
            <div className="system-md-semibold flex h-5 items-center text-text-destructive">
              {t('plugin.installModal.pluginLoadError')}
            </div>
            <div className='system-xs-regular mt-0.5 text-text-tertiary'>
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
