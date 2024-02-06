import type {
  FC,
  ReactNode,
} from 'react'
import { memo } from 'react'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

type BaseNodeProps = {
  children: ReactNode
}

const BaseNode: FC<BaseNodeProps> = ({
  children,
}) => {
  return (
    <div
      className={`
        group relative pb-2 w-[296px] bg-[#fcfdff] border border-white rounded-2xl shadow-xs
        hover:shadow-lg
      `}
    >
      <div className='flex items-center px-3 pt-3 pb-2'>
        <div className='mr-2'></div>
        <div className='text-[13px] font-semibold text-gray-700'>START</div>
      </div>
      {children}
      <div className='px-3 pt-1 pb-1 text-xs text-gray-500'>
        Define the initial parameters for launching a workflow
      </div>
      <div
        className={`
          hidden absolute -bottom-2 left-1/2 -translate-x-1/2 group-hover:flex items-center justify-center 
          w-4 h-4 rounded-full bg-primary-600 cursor-pointer z-10
        `}
      >
        <Plus className='w-2.5 h-2.5 text-white' />
      </div>
    </div>
  )
}

export default memo(BaseNode)
