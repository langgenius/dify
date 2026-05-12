import type { Node, NodeOutPutVar, ValueSelector, Var, VarType } from '@/app/components/workflow/types'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={(
          <div className="w-full cursor-pointer">
            <VariableTag
              valueSelector={valueSelector}
              varType={varType}
              availableNodes={availableNodes}
              isShort
            />
          </div>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          <VarReferenceVars
            vars={nodesOutputVars}
            isSupportFileVar
            onChange={onChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ConditionVarSelector
