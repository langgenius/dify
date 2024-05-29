import { memo } from 'react'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

type NodeVariableItemProps = {
  node: Node
  varName: string
}
const NodeVariableItem = ({
  node,
  varName,
}: NodeVariableItemProps) => {
  return (
    <div className='relative flex items-center mt-0.5 h-6 bg-gray-100 rounded-md  px-1 text-xs font-normal text-gray-700' >
      <div className='flex items-center'>
        <div className='p-[1px]'>
          <VarBlockIcon
            className='!text-gray-900'
            type={node?.data.type || BlockEnum.Start}
          />
        </div>
        <div className='max-w-[85px] truncate mx-0.5 text-xs font-medium text-gray-700' title={node?.data.title}>{node?.data.title}</div>
        <Line3 className='mr-0.5'></Line3>
      </div>
      <div className='flex items-center text-primary-600'>
        <Variable02 className='w-3.5 h-3.5' />
        <div className='max-w-[75px] truncate ml-0.5 text-xs font-medium' title={varName}>{varName}</div>
      </div>
    </div>
  )
}

export default memo(NodeVariableItem)
