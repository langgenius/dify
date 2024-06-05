import {
  memo,
  useState,
} from 'react'
import cn from 'classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { DotsHorizontal } from '@/app/components/base/icons/src/vender/line/general'
import Switch from '@/app/components/base/switch'

const Operator = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 cursor-pointer rounded-lg hover:bg-black/5',
            open && 'bg-black/5',
          )}
        >
          <DotsHorizontal className='w-4 h-4 text-gray-500' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='min-w-[192px] bg-white rounded-md border-[0.5px] border-gray-200 shadow-xl'>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-gray-700 hover:bg-black/5'>
              <div>Copy</div>
              <div>C</div>
            </div>
            <div className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-gray-700 hover:bg-black/5'>
              <div>Duplicate</div>
              <div>D</div>
            </div>
          </div>
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-gray-700 hover:bg-black/5'>
              <div>Show Author</div>
              <Switch size='l' />
            </div>
          </div>
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-gray-700 hover:text-[#D92D20] hover:bg-[#FEF3F2]'>
              <div>Delete</div>
              <div>Backspace</div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Operator)
