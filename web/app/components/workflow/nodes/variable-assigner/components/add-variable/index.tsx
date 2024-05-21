import {
  memo,
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import { useVariableAssigner } from '../../hooks'
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
} from '@/app/components/workflow/types'

export type AddVariableProps = {
  variableAssignerNodeId: string
  availableVars: NodeOutPutVar[]
  handleId?: string
}
const AddVariable = ({
  availableVars,
  variableAssignerNodeId,
  handleId,
}: AddVariableProps) => {
  const [open, setOpen] = useState(false)
  const { handleAssignVariableValueChange } = useVariableAssigner()

  const handleSelectVariable = useCallback((v: ValueSelector) => {
    handleAssignVariableValueChange(
      variableAssignerNodeId,
      v,
      handleId,
    )
    setOpen(false)
  }, [handleAssignVariableValueChange, variableAssignerNodeId, handleId])

  return (
    <div className={cn(
      'hidden group-hover:flex absolute top-0 left-0 z-10',
      open && '!flex',
    )}>
      <PortalToFollowElem
        placement={'left-start'}
        offset={{
          mainAxis: 4,
          crossAxis: -60,
        }}
        open={open}
        onOpenChange={setOpen}
      >
        <PortalToFollowElemTrigger
          onClick={() => setOpen(!open)}
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
