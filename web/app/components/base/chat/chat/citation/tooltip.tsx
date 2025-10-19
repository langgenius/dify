import React, { useState } from 'react'
import type { FC } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type TooltipProps = {
  data: number | string
  text: string
  icon: React.ReactNode
}

const Tooltip: FC<TooltipProps> = ({
  data,
  text,
  icon,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
    >
      <PortalToFollowElemTrigger
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className='mr-6 flex items-center'>
          {icon}
          {data}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='system-xs-medium rounded-lg bg-components-tooltip-bg p-3 text-text-quaternary shadow-lg'>
          {text} {data}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Tooltip
