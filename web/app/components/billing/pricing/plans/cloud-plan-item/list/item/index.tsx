import * as React from 'react'
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
    <div className="flex items-center">
      <span className="grow text-text-secondary system-sm-regular">{label}</span>
      {tooltip && (
        <Tooltip
          content={tooltip}
        />
      )}
    </div>
  )
}

export default React.memo(Item)
