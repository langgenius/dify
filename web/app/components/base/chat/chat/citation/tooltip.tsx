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
        <div className='flex items-center mr-6'>
          {icon}
          {data}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='p-3 bg-white text-xs font-medium text-gray-500 rounded-lg shadow-lg'>
          {text} {data}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Tooltip
