import {
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import { RiDeleteBinLine } from '@remixicon/react'
import type {
  ComparisonOperator,
  Condition,
  HandleRemoveCondition,
  HandleUpdateCondition,
} from '../../types'
import ConditionOperator from './condition-operator'
import ConditionInput from './condition-input'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'

type ConditionItemProps = {
  disabled?: boolean
  caseId: string
  condition: Condition
  onRemoveCondition: HandleRemoveCondition
  onUpdateCondition: HandleUpdateCondition
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
}
const ConditionItem = ({
  disabled,
  caseId,
  condition,
  onRemoveCondition,
  onUpdateCondition,
  nodesOutputVars,
  availableNodes,
}: ConditionItemProps) => {
  const [isHovered, setIsHovered] = useState(false)

  const handleUpdateConditionOperator = useCallback((value: ComparisonOperator) => {
    const newCondition = {
      ...condition,
      comparison_operator: value,
    }
    onUpdateCondition(caseId, condition.id, newCondition)
  }, [caseId, condition, onUpdateCondition])

  const handleUpdateConditionValue = useCallback((value: string) => {
    const newCondition = {
      ...condition,
      value,
    }
    onUpdateCondition(caseId, condition.id, newCondition)
  }, [caseId, condition, onUpdateCondition])

  return (
    <div className='flex mb-1 last-of-type:mb-0'>
      <div className={cn(
        'grow bg-[#C8CEDA]/[0.25] rounded-lg',
        isHovered && 'bg-[#FEF3F2]',
      )}>
        <div className='flex items-center p-1'>
          <div className='grow w-0'>
            <VariableTag
              valueSelector={condition.variable_selector}
              varType={condition.varType}
            />
          </div>
          <div className='mx-1 w-[1px] h-3 bg-[#101828]/[0.08]'></div>
          <ConditionOperator
            disabled={disabled}
            varType={condition.varType}
            value={condition.comparison_operator}
            onSelect={handleUpdateConditionOperator}
          />
        </div>
        <div className='px-2 py-1 max-h-[100px] border-t border-t-[#101828]/[0.04] overflow-y-auto'>
          <ConditionInput
            disabled={disabled}
            value={condition.value}
            onChange={handleUpdateConditionValue}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
          />
        </div>
      </div>
      <div
        className='shrink-0 flex items-center justify-center ml-1 mt-1 w-6 h-6 rounded-lg cursor-pointer hover:bg-[#FEF3F2] text-[#676F83] hover:text-[#D92D20]'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onRemoveCondition(caseId, condition.id)}
      >
        <RiDeleteBinLine className='w-4 h-4' />
      </div>
    </div>
  )
}

export default ConditionItem
