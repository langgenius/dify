'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  value: string[] // plugin ids
  onChange: (value: string[]) => void
}

const PluginsPicker: FC<Props> = ({
  value,
  onChange,
}) => {
  const hasSelected = value.length > 0
  return (
    <div className='rounded-xl'>
      {hasSelected ? (
        <div className='flex justify-between'>
          <div>Selected plugins will not auto-update</div>
        </div>
      ) : (
        <div className='system-xs-regular text-center text-text-tertiary'>
          Only selected plugins will auto-update. No plugins are currently selected, so no plugins will auto-update.
        </div>
      )}
    </div>
  )
}
export default React.memo(PluginsPicker)
