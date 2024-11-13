'use client'
import React from 'react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  open: boolean
  provider?: ToolWithProvider
  value?: {
    provider: string
    tool_name: string
  }
}

const ToolTrigger = ({
  open,
  provider,
  value,
}: Props) => {
  return (
    <div className={cn('group flex items-center p-2 pl-3 bg-components-input-bg-normal rounded-lg hover:bg-state-base-hover-alt', open && 'bg-state-base-hover-alt')}>
      {value && provider && (
        <BlockIcon
          className='shrink-0'
          type={BlockEnum.Tool}
          toolIcon={provider.icon}
        />
      )}
      {value && (
        <div className='grow system-sm-regular text-text-secondary'>{value.tool_name}</div>
      )}
      {!value && (
        <div className='grow text-components-input-text-placeholder system-sm-regular'>Select a tool ...</div>
      )}
      <RiArrowDownSLine className={cn('shrink-0 ml-0.5 w-4 h-4 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
    </div>
  )
}

export default ToolTrigger
