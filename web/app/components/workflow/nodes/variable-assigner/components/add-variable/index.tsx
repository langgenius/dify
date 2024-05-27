import {
  memo,
  useCallback,
} from 'react'
import cn from 'classnames'
import { useVariableAssigner } from '../../hooks'
import type { VariableAssignerNodeType } from '../../types'
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
  open: boolean
  onOpenChange: (open: boolean) => void
  variableAssignerNodeId: string
  variableAssignerNodeData: VariableAssignerNodeType
  availableVars: NodeOutPutVar[]
  handleId?: string
}
const AddVariable = ({
  open,
  onOpenChange,
  availableVars,
  variableAssignerNodeId,
  variableAssignerNodeData,
  handleId,
}: AddVariableProps) => {
  const { handleAssignVariableValueChange } = useVariableAssigner()

  const handleSelectVariable = useCallback((v: ValueSelector, varDetail: Var) => {
    handleAssignVariableValueChange(
      variableAssignerNodeId,
      v,
      varDetail,
      handleId,
    )
    onOpenChange(false)
  }, [handleAssignVariableValueChange, variableAssignerNodeId, handleId, onOpenChange])

  return (
    <div className={cn(
      'hidden group-hover:flex absolute top-0 left-0 z-10 pointer-events-none',
      open && '!flex',
      variableAssignerNodeData.selected && '!flex',
    )}>
      <PortalToFollowElem
        placement={'left-start'}
        offset={{
          mainAxis: 4,
          crossAxis: -60,
        }}
        open={open}
        onOpenChange={onOpenChange}
      >
        <PortalToFollowElemTrigger
          onClick={() => onOpenChange(!open)}
        >
          <div
            className={cn(
              'flex items-center justify-center',
              'w-4 h-4 rounded-full bg-primary-600 cursor-pointer z-10',
            )}
          >
            <Plus02 className='w-2.5 h-2.5 text-white' />
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
