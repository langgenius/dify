import { RiLoopLeftLine } from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import {
  type Condition,
  type HandleAddSubVariableCondition,
  type HandleRemoveCondition,
  type HandleToggleConditionLogicalOperator,
  type HandleToggleSubVariableConditionLogicalOperator,
  type HandleUpdateCondition,
  type HandleUpdateSubVariableCondition,
  LogicalOperator,
  type handleRemoveSubVariableCondition,
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
  conditionId?: string
  conditions: Condition[]
  logicalOperator?: LogicalOperator
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  onToggleConditionLogicalOperator?: HandleToggleConditionLogicalOperator
  nodeId: string
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
  onAddSubVariableCondition?: HandleAddSubVariableCondition
  onRemoveSubVariableCondition?: handleRemoveSubVariableCondition
  onUpdateSubVariableCondition?: HandleUpdateSubVariableCondition
  onToggleSubVariableConditionLogicalOperator?: HandleToggleSubVariableConditionLogicalOperator
  availableVars: NodeOutPutVar[]
}
const ConditionList = ({
  isSubVariable,
  disabled,
  conditionId,
  conditions,
  logicalOperator,
  onUpdateCondition,
  onRemoveCondition,
  onToggleConditionLogicalOperator,
  onAddSubVariableCondition,
  onRemoveSubVariableCondition,
  onUpdateSubVariableCondition,
  onToggleSubVariableConditionLogicalOperator,
  nodeId,
  availableNodes,
  numberVariables,
  availableVars,
}: ConditionListProps) => {
  const doToggleConditionLogicalOperator = useCallback((conditionId?: string) => {
    if (isSubVariable && conditionId)
      onToggleSubVariableConditionLogicalOperator?.(conditionId)
    else
      onToggleConditionLogicalOperator?.()
  }, [isSubVariable, onToggleConditionLogicalOperator, onToggleSubVariableConditionLogicalOperator])

  const isValueFieldShort = useMemo(() => {
    if (isSubVariable && conditions.length > 1)
      return true

    return false
  }, [conditions.length, isSubVariable])
  const conditionItemClassName = useMemo(() => {
    if (!isSubVariable)
      return ''
    if (conditions.length < 2)
      return ''
    return logicalOperator === LogicalOperator.and ? 'pl-[51px]' : 'pl-[42px]'
  }, [conditions.length, isSubVariable, logicalOperator])

  return (
    <div className={cn('relative', conditions.length > 1 && !isSubVariable && 'pl-[60px]')}>
      {
        conditions.length > 1 && (
          <div className={cn(
            'absolute top-0 bottom-0 left-0 w-[60px]',
            isSubVariable && logicalOperator === LogicalOperator.and && 'left-[-10px]',
            isSubVariable && logicalOperator === LogicalOperator.or && 'left-[-18px]',
          )}>
            <div className='absolute top-4 bottom-4 left-[46px] w-2.5 border border-divider-deep rounded-l-[8px] border-r-0'></div>
            <div className='absolute top-1/2 -translate-y-1/2 right-0 w-4 h-[29px] bg-components-panel-bg'></div>
            <div
              className='absolute top-1/2 right-1 -translate-y-1/2 flex items-center px-1 h-[21px] rounded-md border-[0.5px] border-components-button-secondary-border shadow-xs bg-components-button-secondary-bg text-text-accent-secondary text-[10px] font-semibold cursor-pointer select-none'
              onClick={() => doToggleConditionLogicalOperator(conditionId)}
            >
              {logicalOperator && logicalOperator.toUpperCase()}
              <RiLoopLeftLine className='ml-0.5 w-3 h-3' />
            </div>
          </div>
        )
      }
      {
        conditions.map(condition => (
          <ConditionItem
            key={condition.id}
            className={conditionItemClassName}
            disabled={disabled}
            conditionId={isSubVariable ? conditionId! : condition.id}
            condition={condition}
            isValueFieldShort={isValueFieldShort}
            onUpdateCondition={onUpdateCondition}
            onRemoveCondition={onRemoveCondition}
            onAddSubVariableCondition={onAddSubVariableCondition}
            onRemoveSubVariableCondition={onRemoveSubVariableCondition}
            onUpdateSubVariableCondition={onUpdateSubVariableCondition}
            onToggleSubVariableConditionLogicalOperator={onToggleSubVariableConditionLogicalOperator}
            nodeId={nodeId}
            availableNodes={availableNodes}
            numberVariables={numberVariables}
            isSubVariableKey={isSubVariable}
            availableVars={availableVars}
          />
        ))
      }
    </div>
  )
}

export default ConditionList
