import type { VariableAssignerNodeType } from '../../types'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
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

  const handleSelectVariable = useCallback((v: ValueSelector, varDetail: Var) => {
    handleAssignVariableValueChange(
      variableAssignerNodeId,
      v,
      varDetail,
      handleId,
    )
    setOpen(false)
  }, [handleAssignVariableValueChange, variableAssignerNodeId, handleId, setOpen])

  return (
    <div className={cn(
      open && 'flex!',
      variableAssignerNodeData.selected && 'flex!',
    )}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          render={(
            <button type="button" className="block border-none bg-transparent p-0">
              <div
                className={cn(
                  'group/addvariable flex items-center justify-center',
                  'h-4 w-4 cursor-pointer',
                  'hover:rounded-full hover:bg-primary-600',
                  open && 'rounded-full! bg-primary-600!',
                )}
              >
                <Plus02
                  className={cn(
                    'h-2.5 w-2.5 text-text-tertiary',
                    'group-hover/addvariable:text-text-primary',
                    open && 'text-text-primary!',
                  )}
                />
              </div>
            </button>
          )}
        />
        <PopoverContent
          placement="right"
          sideOffset={4}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <AddVariablePopup
            onSelect={handleSelectVariable}
            availableVars={availableVars}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default memo(AddVariable)
