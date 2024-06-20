import type { FC } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'

type ModelTriggerProps = {
  open: boolean
  className?: string
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  className,
}) => {
  return (
    <div
      className={`
        flex items-center px-2 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer
        ${className}
        ${open && '!bg-gray-200'}
      `}
    >
      <div className='grow flex items-center'>
        <div className='mr-1.5 flex items-center justify-center w-4 h-4 rounded-[5px] border border-dashed border-black/5'>
          <CubeOutline className='w-3 h-3 text-gray-400' />
        </div>
        <div
          className='text-[13px] text-gray-500 truncate'
          title='Select model'
        >
          Select model
        </div>
      </div>
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <RiArrowDownSLine className='w-3.5 h-3.5 text-gray-500' />
      </div>
    </div>
  )
}

export default ModelTrigger
