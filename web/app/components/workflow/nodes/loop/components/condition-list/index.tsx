import type {
  Condition,
  HandleAddSubVariableCondition,
  HandleRemoveCondition,
  handleRemoveSubVariableCondition,
  HandleToggleConditionLogicalOperator,
  HandleToggleSubVariableConditionLogicalOperator,
  HandleUpdateCondition,
  HandleUpdateSubVariableCondition,
} from '../../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiLoopLeftLine } from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import { LogicalOperator } from '../../types'
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
  const doToggleConditionLogicalOperator = useCallback(
    (conditionId?: string) => {
      if (isSubVariable && conditionId) onToggleSubVariableConditionLogicalOperator?.(conditionId)
      else onToggleConditionLogicalOperator?.()
    },
    [isSubVariable, onToggleConditionLogicalOperator, onToggleSubVariableConditionLogicalOperator],
  )

  const isValueFieldShort = useMemo(() => {
    if (isSubVariable && conditions.length > 1) return true

    return false
  }, [conditions.length, isSubVariable])
  const conditionItemClassName = useMemo(() => {
    if (!isSubVariable) return ''
    if (conditions.length < 2) return ''
    return logicalOperator === LogicalOperator.and ? 'pl-[51px]' : 'pl-[42px]'
  }, [conditions.length, isSubVariable, logicalOperator])

  return (
    <div className={cn('relative', conditions.length > 1 && !isSubVariable && 'pl-15')}>
      {conditions.length > 1 && (
        <div
          className={cn(
            'absolute top-0 bottom-0 left-0 w-15',
            isSubVariable && logicalOperator === LogicalOperator.and && '-left-2.5',
            isSubVariable && logicalOperator === LogicalOperator.or && '-left-4.5',
          )}
        >
          <div className="absolute top-4 bottom-4 left-11.5 w-2.5 rounded-l-lg border border-r-0 border-divider-deep"></div>
          <div className="absolute top-1/2 right-0 h-7.25 w-4 -translate-y-1/2 bg-components-panel-bg"></div>
          <div
            className="absolute top-1/2 right-1 flex h-5.25 -translate-y-1/2 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1 text-2xs font-semibold text-text-accent-secondary shadow-xs select-none"
            onClick={() => doToggleConditionLogicalOperator(conditionId)}
          >
            {!!logicalOperator && logicalOperator.toUpperCase()}
            <RiLoopLeftLine className="ml-0.5 size-3" />
          </div>
        </div>
      )}
      {conditions.map((condition) => (
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
      ))}
    </div>
  )
}

export default ConditionList
