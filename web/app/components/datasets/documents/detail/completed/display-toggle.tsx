import React, { type FC } from 'react'
import { RiLineHeight } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { Collapse } from '@/app/components/base/icons/src/public/knowledge'

type DisplayToggleProps = {
  isCollapsed: boolean
  toggleCollapsed: () => void
}

const DisplayToggle: FC<DisplayToggleProps> = ({
  isCollapsed,
  toggleCollapsed,
}) => {
  return (
    <Tooltip
      popupContent={isCollapsed ? 'Expand chunks' : 'Collapse chunks'}
      popupClassName='text-text-secondary system-xs-medium border-[0.5px] border-components-panel-border'
    >
      <button
        className='flex items-center justify-center p-2 rounded-lg bg-components-button-secondary-bg cursor-pointer
        border-[0.5px] border-components-button-secondary-border shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]'
        onClick={toggleCollapsed}
      >
        {
          isCollapsed
            ? <RiLineHeight className='w-4 h-4 text-components-button-secondary-text' />
            : <Collapse className='w-4 h-4 text-components-button-secondary-text' />
        }
      </button>

    </Tooltip>
  )
}

export default React.memo(DisplayToggle)
