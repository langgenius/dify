import {
  useCallback,
  useState,
} from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import type { VarType as NumberVarType } from '../../../tool/types'
import type {
  ComparisonOperator,
  Condition,
  HandleRemoveCondition,
  HandleUpdateCondition,
} from '../../types'
import { comparisonOperatorNotRequireValue } from '../../utils'
import ConditionNumberInput from '../condition-number-input'
import ConditionOperator from './condition-operator'
import ConditionInput from './condition-input'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type ConditionItemProps = {
  disabled?: boolean
  caseId: string
  condition: Condition
  onRemoveCondition: HandleRemoveCondition
  onUpdateCondition: HandleUpdateCondition
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
}
const ConditionItem = ({
  disabled,
  caseId,
  condition,
  onRemoveCondition,
  onUpdateCondition,
  nodesOutputVars,
  availableNodes,
  numberVariables,
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

  const handleUpdateConditionNumberVarType = useCallback((numberVarType: NumberVarType) => {
    const newCondition = {
      ...condition,
      numberVarType,
      value: '',
    }
    onUpdateCondition(caseId, condition.id, newCondition)
  }, [caseId, condition, onUpdateCondition])

  return (
    <div className='flex mb-1 last-of-type:mb-0'>
      <div className={cn(
        'grow bg-components-input-bg-normal rounded-lg',
        isHovered && 'bg-state-destructive-hover',
      )}>
        <div className='flex items-center p-1'>
          <div className='grow w-0'>
            <VariableTag
              valueSelector={condition.variable_selector}
              varType={condition.varType}
            />
          </div>
          <div className='mx-1 w-[1px] h-3 bg-divider-regular'></div>
          <ConditionOperator
            disabled={disabled}
            varType={condition.varType}
            value={condition.comparison_operator}
            onSelect={handleUpdateConditionOperator}
          />
        </div>
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && condition.varType !== VarType.number && (
            <div className='px-2 py-1 max-h-[100px] border-t border-t-divider-subtle overflow-y-auto'>
              <ConditionInput
                disabled={disabled}
                value={condition.value}
                onChange={handleUpdateConditionValue}
                nodesOutputVars={nodesOutputVars}
                availableNodes={availableNodes}
              />
            </div>
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && condition.varType === VarType.number && (
            <div className='px-2 py-1 pt-[3px] border-t border-t-divider-subtle'>
              <ConditionNumberInput
                numberVarType={condition.numberVarType}
                onNumberVarTypeChange={handleUpdateConditionNumberVarType}
                value={condition.value}
                onValueChange={handleUpdateConditionValue}
                variables={numberVariables}
              />
            </div>
          )
        }
      </div>
      <div
        className='shrink-0 flex items-center justify-center ml-1 mt-1 w-6 h-6 rounded-lg cursor-pointer hover:bg-state-destructive-hover text-text-tertiary hover:text-text-destructive'
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
