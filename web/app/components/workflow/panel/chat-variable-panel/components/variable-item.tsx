import { memo, useState } from 'react'
import { capitalize } from 'lodash-es'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import type { ConversationVariable } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type VariableItemProps = {
  item: ConversationVariable
  onEdit: (item: ConversationVariable) => void
  onDelete: (item: ConversationVariable) => void
}

const VariableItem = ({
  item,
  onEdit,
  onDelete,
}: VariableItemProps) => {
  const [destructive, setDestructive] = useState(false)
  return (
    <div className={cn(
      'mb-1 px-2.5 py-2 bg-components-panel-on-panel-item-bg radius-md border border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
      destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}>
      <div className='flex items-center justify-between'>
        <div className='grow flex gap-1 items-center'>
          <BubbleX className='w-4 h-4 text-util-colors-teal-teal-700' />
          <div className='text-text-primary system-sm-medium'>{item.name}</div>
          <div className='text-text-tertiary system-xs-medium'>{capitalize(item.value_type)}</div>
        </div>
        <div className='shrink-0 flex gap-1 items-center text-text-tertiary'>
          <div className='p-1 radius-md cursor-pointer hover:bg-state-base-hover hover:text-text-secondary'>
            <RiEditLine className='w-4 h-4' onClick={() => onEdit(item)}/>
          </div>
          <div
            className='p-1 radius-md cursor-pointer hover:bg-state-destructive-hover hover:text-text-destructive'
            onMouseOver={() => setDestructive(true)}
            onMouseOut={() => setDestructive(false)}
          >
            <RiDeleteBinLine className='w-4 h-4' onClick={() => onDelete(item)}/>
          </div>
        </div>
      </div>
      <div className='text-text-tertiary system-xs-regular truncate'>{item.description}</div>
    </div>
  )
}

export default memo(VariableItem)
