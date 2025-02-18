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
      'bg-components-panel-on-panel-item-bg radius-md border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover mb-1 border px-2.5 py-2',
      destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}>
      <div className='flex items-center justify-between'>
        <div className='flex grow items-center gap-1'>
          <BubbleX className='text-util-colors-teal-teal-700 h-4 w-4' />
          <div className='text-text-primary system-sm-medium'>{item.name}</div>
          <div className='text-text-tertiary system-xs-medium'>{capitalize(item.value_type)}</div>
        </div>
        <div className='text-text-tertiary flex shrink-0 items-center gap-1'>
          <div className='radius-md hover:bg-state-base-hover hover:text-text-secondary cursor-pointer p-1'>
            <RiEditLine className='h-4 w-4' onClick={() => onEdit(item)}/>
          </div>
          <div
            className='radius-md hover:bg-state-destructive-hover hover:text-text-destructive cursor-pointer p-1'
            onMouseOver={() => setDestructive(true)}
            onMouseOut={() => setDestructive(false)}
          >
            <RiDeleteBinLine className='h-4 w-4' onClick={() => onDelete(item)}/>
          </div>
        </div>
      </div>
      <div className='text-text-tertiary system-xs-regular truncate'>{item.description}</div>
    </div>
  )
}

export default memo(VariableItem)
