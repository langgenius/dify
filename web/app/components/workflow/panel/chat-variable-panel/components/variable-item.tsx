import type { ConversationVariable } from '@/app/components/workflow/types'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { capitalize } from 'es-toolkit/string'
import { memo, useState } from 'react'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import { cn } from '@/utils/classnames'

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
      'radius-md mb-1 border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2.5 py-2 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
      destructive && 'border-state-destructive-border hover:bg-state-destructive-hover',
    )}
    >
      <div className="flex items-center justify-between">
        <div className="flex grow items-center gap-1">
          <BubbleX className="h-4 w-4 text-util-colors-teal-teal-700" />
          <div className="system-sm-medium text-text-primary">{item.name}</div>
          <div className="system-xs-medium text-text-tertiary">{capitalize(item.value_type)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-text-tertiary">
          <div className="radius-md cursor-pointer p-1 hover:bg-state-base-hover hover:text-text-secondary">
            <RiEditLine className="h-4 w-4" onClick={() => onEdit(item)} />
          </div>
          <div
            className="radius-md cursor-pointer p-1 hover:bg-state-destructive-hover hover:text-text-destructive"
            onMouseOver={() => setDestructive(true)}
            onMouseOut={() => setDestructive(false)}
          >
            <RiDeleteBinLine className="h-4 w-4" onClick={() => onDelete(item)} />
          </div>
        </div>
      </div>
      <div className="system-xs-regular truncate text-text-tertiary">{item.description}</div>
    </div>
  )
}

export default memo(VariableItem)
