import type { Node, NodeOutPutVar, ValueSelector, Var, VarType } from '@/app/components/workflow/types'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'

type ConditionVarSelectorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  valueSelector: ValueSelector
  varType: VarType
  availableNodes: Node[]
  nodesOutputVars: NodeOutPutVar[]
  onChange: (valueSelector: ValueSelector, varItem: Var) => void
}

const ConditionVarSelector = ({
  open,
  onOpenChange,
  valueSelector,
  varType,
  availableNodes,
  nodesOutputVars,
  onChange,
}: ConditionVarSelectorProps) => {
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={onOpenChange}
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => onOpenChange(!open)}>
        <div className="w-full cursor-pointer">
          <VariableTag
            valueSelector={valueSelector}
            varType={varType}
            availableNodes={availableNodes}
            isShort
          />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
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

export default ConditionVarSelector
