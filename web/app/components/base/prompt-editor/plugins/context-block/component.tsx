import { useState } from 'react'
import { File05 } from '@/app/components/base/icons/src/vender/solid/files'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const ContextBlockComponent = () => {
  const [open, setOpen] = useState(false)

  return (
    <div className={`
      group inline-flex items-center pl-1 pr-0.5 h-6 border border-transparent bg-[#F4F3FF] text-[#6938EF] rounded-[5px] hover:bg-[#EBE9FE]
      ${open ? 'bg-[#EBE9FE]' : 'bg-[#F4F3FF]'}
    `}>
      <File05 className='mr-1 w-[14px] h-[14px]' />
      <div className='mr-1 text-xs font-medium'>Context</div>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-end'
        offset={{
          mainAxis: 3,
          crossAxis: -147,
        }}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
          <div className={`
            flex items-center justify-center w-[18px] h-[18px] text-[11px] font-semibold rounded cursor-pointer
            ${open ? 'bg-[#6938EF] text-white' : 'bg-white/50 group-hover:bg-white group-hover:shadow-xs'}
          `}>2</div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent>
          <div className='w-[360px] bg-white rounded-xl shadow-lg'>
            <div className='p-4'>
              <div className='mb-2 text-xs font-medium text-gray-500'>2 Datasets in Context</div>
              <div className='flex items-center h-8'>
                <div className='shrink-0 mr-2 w-6 h-6 rounded-md border-[0.5px] border-[#EAECF5]'></div>
                <div className='text-sm text-gray-800 truncate' title=''>Understand 1000 years of coffee history in 3 minutes.</div>
              </div>
              <div className='flex items-center h-8 text-[#155EEF] cursor-pointer'>
                <div className='shrink-0 flex justify-center items-center mr-2 w-6 h-6 rounded-md border-[0.5px] border-gray-100'>
                  <Plus className='w-[14px] h-[14px]' />
                </div>
                <div className='text-[13px] font-medium' title=''>Add Context </div>
              </div>
            </div>
            <div className='px-4 py-3 text-xs text-gray-500 bg-gray-50 border-t-[0.5px] border-gray-50 rounded-b-xl'>
              You can manage contexts in the Context section below.
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default ContextBlockComponent
