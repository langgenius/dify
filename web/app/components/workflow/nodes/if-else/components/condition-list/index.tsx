import { RiLoopLeftLine } from '@remixicon/react'
import { useCallback } from 'react'
import type {
  CaseItem,
  HandleAddSubVariableCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleToggleSubVariableConditionLogicalOperator,
  HandleUpdateCondition,
  HandleUpdateSubVariableCondition,
  handleRemoveSubVariableCondition,
} from '../../types'
import ConditionItem from './condition-item'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type ConditionListProps = {
  isSubVariable?: boolean
  disabled?: boolean
  caseId: string
  conditionId?: string
  caseItem: CaseItem
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  onToggleConditionLogicalOperator?: HandleToggleConditionLogicalOperator
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
  varsIsVarFileAttribute: Record<string, boolean>
  onAddSubVariableCondition?: HandleAddSubVariableCondition
  onRemoveSubVariableCondition?: handleRemoveSubVariableCondition
  onUpdateSubVariableCondition?: HandleUpdateSubVariableCondition
  onToggleSubVariableConditionLogicalOperator?: HandleToggleSubVariableConditionLogicalOperator
}
const ConditionList = ({
  isSubVariable,
  disabled,
  caseId,
  conditionId,
  caseItem,
  onUpdateCondition,
  onRemoveCondition,
  onToggleConditionLogicalOperator,
  onAddSubVariableCondition,
  onRemoveSubVariableCondition,
  onUpdateSubVariableCondition,
  onToggleSubVariableConditionLogicalOperator,
  nodesOutputVars,
  availableNodes,
  numberVariables,
  varsIsVarFileAttribute,
}: ConditionListProps) => {
  const { conditions, logical_operator } = caseItem

  const doToggleConditionLogicalOperator = useCallback(() => {
    if (isSubVariable)
      onToggleSubVariableConditionLogicalOperator?.(caseId!, conditionId!)
    else
      onToggleConditionLogicalOperator?.(caseId)
  }, [caseId, conditionId, isSubVariable, onToggleConditionLogicalOperator, onToggleSubVariableConditionLogicalOperator])

  return (
    <div className={cn('relative', !isSubVariable && 'pl-[60px]')}>
      {
        conditions.length > 1 && (
          <div className='absolute top-0 bottom-0 left-0 w-[60px]'>
            <div className='absolute top-4 bottom-4 left-[46px] w-2.5 border border-divider-deep rounded-l-[8px] border-r-0'></div>
            <div className='absolute top-1/2 -translate-y-1/2 right-0 w-4 h-[29px] bg-components-panel-bg'></div>
            <div
              className='absolute top-1/2 right-1 -translate-y-1/2 flex items-center px-1 h-[21px] rounded-md border-[0.5px] border-components-button-secondary-border shadow-xs bg-components-button-secondary-bg text-text-accent-secondary text-[10px] font-semibold cursor-pointer'
              onClick={doToggleConditionLogicalOperator}
            >
              {logical_operator.toUpperCase()}
              <RiLoopLeftLine className='ml-0.5 w-3 h-3' />
            </div>
          </div>
        )
      }
      {
        caseItem.conditions.map(condition => (
          <ConditionItem
            key={condition.id}
            disabled={disabled}
            caseId={caseId}
            conditionId={isSubVariable ? conditionId! : condition.id}
            condition={condition}
            onUpdateCondition={onUpdateCondition}
            onRemoveCondition={onRemoveCondition}
            onAddSubVariableCondition={onAddSubVariableCondition}
            onRemoveSubVariableCondition={onRemoveSubVariableCondition}
            onUpdateSubVariableCondition={onUpdateSubVariableCondition}
            onToggleSubVariableConditionLogicalOperator={onToggleSubVariableConditionLogicalOperator}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
            numberVariables={numberVariables}
            file={varsIsVarFileAttribute[condition.id] ? { key: (condition.variable_selector || []).slice(-1)[0] } : undefined}
            isSubVariableKey={isSubVariable}
          />
        ))
      }
    </div>
  )
}

export default ConditionList
