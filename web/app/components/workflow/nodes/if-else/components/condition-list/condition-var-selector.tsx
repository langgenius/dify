import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
  VarType,
} from '@/app/components/workflow/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useRef } from 'react'
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        // TODO: Declare non-native button semantics for this div trigger to support keyboard activation.
        render={
          <div className="w-full cursor-pointer">
            <VariableTag
              valueSelector={valueSelector}
              varType={varType}
              availableNodes={availableNodes}
              isShort
            />
          </div>
        }
      />
      <PopoverContent
        initialFocus={searchInputRef}
        placement="bottom-start"
        sideOffset={4}
        className="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-74 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
          <VarReferenceVars
            searchInputRef={searchInputRef}
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
