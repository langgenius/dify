import { useState } from 'react'
import type { FC } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { TypeSquare } from '@/app/components/base/icons/src/vender/line/editor'

type TooltipProps = {
  data: number | string
  text: string
}

const Tooltip: FC<TooltipProps> = ({
  data,
  text,
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
          <TypeSquare className='mr-1 w-3 h-3' />
          {data}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-3 bg-white text-xs font-medium text-gray-500 rounded-lg shadow-lg'>
          {text} {data}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Tooltip
