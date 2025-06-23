'use client'
import type { FC } from 'react'
import React from 'react'
import NoPluginSelected from './no-plugin-selected'
import type { AUTO_UPDATE_MODE } from './types'
import PluginsSelected from './plugins-selected'
import Button from '@/app/components/base/button'
import { RiAddLine } from '@remixicon/react'

type Props = {
  updateMode: AUTO_UPDATE_MODE
  value: string[] // plugin ids
  onChange: (value: string[]) => void
}

const PluginsPicker: FC<Props> = ({
  updateMode,
  value,
  onChange,
}) => {
  const hasSelected = value.length > 0
  return (
    <div className='mt-2 rounded-[10px] bg-background-section-burn p-2.5'>
      {hasSelected ? (
        <div className='flex justify-between text-text-tertiary'>
          <div className='system-xs-medium'>The following 21 plugins will not auto-update</div>
          <div className='system-xs-medium cursor-pointer'>Clear all</div>
        </div>
      ) : (
        <NoPluginSelected updateMode={updateMode} />
      )}

      <PluginsSelected
        className='mt-2'
        plugins={value}
      />

      <Button className='mt-2 w-full' size='small' variant='secondary-accent'>
        <RiAddLine className='size-3.5' />
        Select
      </Button>
    </div>
  )
}
export default React.memo(PluginsPicker)
