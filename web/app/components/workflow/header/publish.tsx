import { useState } from 'react'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const Publish = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -5,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <Button
          type='primary'
          className='px-3 py-0 h-8 text-[13px] font-medium'
        >
          publish
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[320px] bg-white rounded-2xl border-[0.5px] border-gray-200 shadow-xl'>
          <div className='p-4 pt-3'>
            <div className='flex items-center h-6 text-xs font-medium text-gray-500'>
              Current Draft
            </div>
            <div className='flex items-center h-[18px] text-[13px] font-medium text-gray-700'>
              Auto-Saved 3 min ago · Evan
            </div>
            <Button
              type='primary'
              className='mt-3 px-3 py-0 w-full h-8 border-[0.5px] border-primary-700 rounded-lg text-[13px] font-medium'
            >
              Publish
            </Button>
          </div>
          <div className='p-4 pt-3 border-t-[0.5px] border-t-black/5'>
            <div className='flex items-center h-6 text-xs font-medium text-gray-500'>
              Latest Published
            </div>
            <div className='flex justify-between'>
              <div className='flex items-center mt-[3px] mb-[3px] leading-[18px] text-[13px] font-medium text-gray-700'>
                Auto-Saved 3 min ago · Evan
              </div>
              <Button className='ml-2 px-2 py-0 h-6 shadow-xs rounded-md text-xs font-medium text-gray-700 border-[0.5px] border-gray-200'>
                Restore
              </Button>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Publish
