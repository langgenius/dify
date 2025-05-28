import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useVariableAssigner } from '../../hooks'
import type { VariableAssignerNodeType } from '../../types'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'
import AddVariablePopup from '@/app/components/workflow/nodes/_base/components/add-variable-popup'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'

export type AddVariableProps = {
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
      open && '!flex',
      variableAssignerNodeData.selected && '!flex',
    )}>
      <PortalToFollowElem
        placement={'right'}
        offset={4}
        open={open}
        onOpenChange={setOpen}
      >
        <PortalToFollowElemTrigger
          onClick={() => setOpen(!open)}
        >
          <div
            className={cn(
              'group/addvariable flex items-center justify-center',
              'h-4 w-4 cursor-pointer',
              'hover:rounded-full hover:bg-primary-600',
              open && '!rounded-full !bg-primary-600',
            )}
          >
            <Plus02
              className={cn(
                'h-2.5 w-2.5 text-text-tertiary',
                'group-hover/addvariable:text-text-primary',
                open && '!text-text-primary',
              )}
            />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <AddVariablePopup
            onSelect={handleSelectVariable}
            availableVars={availableVars}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default memo(AddVariable)
