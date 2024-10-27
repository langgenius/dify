import {
  RiExternalLinkLine,
} from '@remixicon/react'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'

const ModelTrigger = () => {
  return (
    <div className='flex items-center px-2 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer'>
      <div className='grow flex items-center'>
        <div className='mr-1.5 flex items-center justify-center w-4 h-4 rounded-[5px] border-dashed border-black/5'>
          <CubeOutline className='w-[11px] h-[11px] text-gray-400' />
        </div>
        <div
          className='text-[13px] text-gray-500 truncate'
          title='Select model'
        >
          Please setup the Rerank model
        </div>
      </div>
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <RiExternalLinkLine className='w-3.5 h-3.5 text-gray-500' />
      </div>
    </div>
  )
}

export default ModelTrigger
