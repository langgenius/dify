import React from 'react'
import Tooltip from './tooltip'

type ItemProps = {
  label: string
  tooltip?: string
}

const Item = ({
  label,
  tooltip,
}: ItemProps) => {
  return (
    <div className='flex items-center'>
      <span className='system-sm-regular ml-2 mr-0.5 grow text-text-secondary'>{label}</span>
      {tooltip && (
        <Tooltip
          content={tooltip}
        />
      )}
    </div>
  )
}

export default React.memo(Item)
