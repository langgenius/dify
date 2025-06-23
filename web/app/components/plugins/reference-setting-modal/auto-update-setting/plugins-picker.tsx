'use client'
import type { FC } from 'react'
import React from 'react'
import NoPluginSelected from './no-plugin-selected'
import type { AUTO_UPDATE_MODE } from './types'

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
        <div className='flex justify-between'>
          <div>Selected plugins will not auto-update</div>
        </div>
      ) : (
        <NoPluginSelected updateMode={updateMode} />
      )}

    </div>
  )
}
export default React.memo(PluginsPicker)
