import { memo } from 'react'
import cn from '@/utils/classnames'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

type NodeVariableItemProps = {
  isEnv: boolean
  node: Node
  varName: string
  showBorder?: boolean
}
const NodeVariableItem = ({
  isEnv,
  node,
  varName,
  showBorder,
}: NodeVariableItemProps) => {
  return (
    <div className={cn(
      'relative flex items-center mt-0.5 h-6 bg-gray-100 rounded-md  px-1 text-xs font-normal text-gray-700',
      showBorder && '!bg-black/[0.02]',
    )}>
      {!isEnv && (
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
      )}
      <div className='flex items-center text-primary-600'>
        {!isEnv && <Variable02 className='shrink-0 w-3.5 h-3.5 text-primary-500' />}
        {isEnv && <Env className='shrink-0 w-3.5 h-3.5 text-util-colors-violet-violet-600' />}
        <div className={cn('max-w-[75px] truncate ml-0.5 text-xs font-medium', isEnv && 'text-gray-900')} title={varName}>{varName}</div>
      </div>
    </div>
  )
}

export default memo(NodeVariableItem)
