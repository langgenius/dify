import type { Condition, HandleAddSubVariableCondition, HandleRemoveCondition, handleRemoveSubVariableCondition, HandleToggleConditionLogicalOperator, HandleToggleSubVariableConditionLogicalOperator, HandleUpdateCondition, HandleUpdateSubVariableCondition } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { RiLoopLeftLine } from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import { cn } from '@/utils/classnames'
import {

  LogicalOperator,

} from '../../types'
import ConditionItem from './condition-item'

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
            'absolute bottom-0 left-0 top-0 w-[60px]',
            isSubVariable && logicalOperator === LogicalOperator.and && 'left-[-10px]',
            isSubVariable && logicalOperator === LogicalOperator.or && 'left-[-18px]',
          )}
          >
            <div className="absolute bottom-4 left-[46px] top-4 w-2.5 rounded-l-[8px] border border-r-0 border-divider-deep"></div>
            <div className="absolute right-0 top-1/2 h-[29px] w-4 -translate-y-1/2 bg-components-panel-bg"></div>
            <div
              className="absolute right-1 top-1/2 flex h-[21px] -translate-y-1/2 cursor-pointer select-none items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1 text-[10px] font-semibold text-text-accent-secondary shadow-xs"
              onClick={() => doToggleConditionLogicalOperator(conditionId)}
            >
              {!!logicalOperator && logicalOperator.toUpperCase()}
              <RiLoopLeftLine className="ml-0.5 h-3 w-3" />
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
