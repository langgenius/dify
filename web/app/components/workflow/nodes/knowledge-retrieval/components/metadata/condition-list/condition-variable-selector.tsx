import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

type ConditionVariableSelectorProps = {
  valueSelector?: ValueSelector
  varType?: VarType
  availableNodes?: Node[]
  nodesOutputVars?: NodeOutPutVar[]
  onChange: (valueSelector: ValueSelector, varItem: Var) => void
}

const ConditionVariableSelector = ({
  valueSelector = [],
  varType = VarType.string,
  availableNodes = [],
  nodesOutputVars = [],
  onChange,
}: ConditionVariableSelectorProps) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <div className="cursor-pointer">
          <VariableTag
            valueSelector={valueSelector}
            varType={varType}
            availableNodes={availableNodes}
            isShort
          />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[296px] bg-components-panel-bg-blur rounded-lg border-[0.5px] border-components-panel-border shadow-lg'>
          <VarReferenceVars
            vars={nodesOutputVars}
            isSupportFileVar
            onChange={onChange}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionVariableSelector
