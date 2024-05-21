import {
  memo,
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import type { VariableAssignerNodeType } from '../../types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'
import type { Node } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import AddVariablePopup from '@/app/components/workflow/nodes/_base/components/add-variable-popup'

export type AddVariableProps = {
  nodeId: string
  data: Node['data']
}
const AddVariable = ({
  nodeId,
  data,
}: AddVariableProps) => {
  const [open, setOpen] = useState(false)
  const { availableVars } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  const handleSelectVariable = useCallback(() => {
    setOpen(false)
  }, [])

  return (
    <div className={cn(
      'hidden group-hover:flex absolute top-0 -left-[9px] z-[2]',
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
            variableAssignerNodeId={nodeId}
            variableAssignerNodeData={data as VariableAssignerNodeType}
            onSelect={handleSelectVariable}
            availableVars={availableVars}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default memo(AddVariable)
