import type { VariableAssignerNodeType } from '../../types'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo, useCallback, useState } from 'react'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'
import AddVariablePopup from '@/app/components/workflow/nodes/_base/components/add-variable-popup'
import { useVariableAssigner } from '../../hooks'

type AddVariableProps = {
  variableAssignerNodeId: string
  variableAssignerNodeData: VariableAssignerNodeType
  availableVars: NodeOutPutVar[]
  handleId?: string
}
const AddVariable = ({
  availableVars,
  variableAssignerNodeId,
  variableAssignerNodeData,
  handleId,
}: AddVariableProps) => {
  const [open, setOpen] = useState(false)
  const { handleAssignVariableValueChange } = useVariableAssigner()

  const handleSelectVariable = useCallback(
    (v: ValueSelector, varDetail: Var) => {
      handleAssignVariableValueChange(variableAssignerNodeId, v, varDetail, handleId)
      setOpen(false)
    },
    [handleAssignVariableValueChange, variableAssignerNodeId, handleId, setOpen],
  )

  return (
    <div className={cn(open && 'flex!', variableAssignerNodeData.selected && 'flex!')}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={(props, state) => (
            <button
              {...props}
              type="button"
              className={cn('block border-none bg-transparent p-0', props.className)}
            >
              <div
                className={cn(
                  'group/addvariable flex items-center justify-center',
                  'size-4 cursor-pointer',
                  'hover:rounded-full hover:bg-primary-600',
                  state.open && 'rounded-full! bg-primary-600!',
                )}
              >
                <Plus02
                  className={cn(
                    'size-2.5 text-text-tertiary',
                    'group-hover/addvariable:text-text-primary',
                    state.open && 'text-text-primary!',
                  )}
                />
              </div>
            </button>
          )}
        />
        <PopoverContent
          placement="right"
          sideOffset={4}
          className="border-none bg-transparent shadow-none"
        >
          <AddVariablePopup onSelect={handleSelectVariable} availableVars={availableVars} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default memo(AddVariable)
