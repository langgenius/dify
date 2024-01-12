import type { FC } from 'react'
import { useState } from 'react'
import { DotsHorizontal } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type DropdownProps = {
  onSelect: (item: { key: string; value: string }) => void
}
const Dropdown: FC<DropdownProps> = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div
          className={`
            flex items-center justify-center w-6 h-6 cursor-pointer rounded-md
            ${open && 'bg-black/5'}
          `}
        >
          <DotsHorizontal className='w-4 h-4 text-gray-500' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg text-sm text-gray-700'>
          <div className='p-1'>
            <div className='flex items-center px-3 h-8 rounded-lg cursor-pointer hover:bg-gray-100'>Duplicate</div>
            <div className='flex items-center px-3 h-8 rounded-lg cursor-pointer hover:bg-gray-100'>Debug as Single Model</div>
          </div>
          <div className='h-[1px] bg-gray-100' />
          <div className='p-1'>
            <div className='flex items-center px-3 h-8 rounded-lg cursor-pointer hover:bg-gray-100'>Remove</div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Dropdown
