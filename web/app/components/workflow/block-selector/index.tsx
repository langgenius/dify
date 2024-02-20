import type { FC } from 'react'
import { memo } from 'react'
import Tabs from './tabs'
import type { OnSelect } from './types'
import { SearchLg } from '@/app/components/base/icons/src/vender/line/general'

type NodeSelectorProps = {
  onSelect: OnSelect
  className?: string
}
const NodeSelector: FC<NodeSelectorProps> = ({
  onSelect,
  className,
}) => {
  return (
    <div className={`w-[256px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg ${className}`}>
      <div className='px-2 pt-2'>
        <div className='flex items-center px-2 rounded-lg bg-gray-100'>
          <SearchLg className='shrink-0 ml-[1px] mr-[5px] w-3.5 h-3.5 text-gray-400' />
          <input
            className='grow px-0.5 py-[7px] text-[13px] bg-transparent appearance-none outline-none'
            placeholder='Search block'
          />
        </div>
      </div>
      <Tabs onSelect={onSelect} />
    </div>
  )
}

export default memo(NodeSelector)
