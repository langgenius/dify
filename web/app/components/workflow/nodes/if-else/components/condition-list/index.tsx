import type {
  CaseItem,
  HandleAddSubVariableCondition,
  HandleRemoveCondition,
  handleRemoveSubVariableCondition,
  HandleToggleConditionLogicalOperator,
  HandleToggleSubVariableConditionLogicalOperator,
  HandleUpdateCondition,
  HandleUpdateSubVariableCondition,
} from '../../types'
import type { Node, NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiLoopLeftLine } from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import { LogicalOperator } from '../../types'
import ConditionItem from './condition-item'

type ConditionListProps = {
  isSubVariable?: boolean
  disabled?: boolean
  caseId: string
  conditionId?: string
  caseItem: CaseItem
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  onToggleConditionLogicalOperator?: HandleToggleConditionLogicalOperator
  nodeId: string
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
  filterVar: (varPayload: Var) => boolean
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
  nodeId,
  nodesOutputVars,
  availableNodes,
  numberVariables,
  varsIsVarFileAttribute,
  filterVar,
}: ConditionListProps) => {
  const { conditions, logical_operator } = caseItem

  const doToggleConditionLogicalOperator = useCallback(() => {
    if (isSubVariable) onToggleSubVariableConditionLogicalOperator?.(caseId!, conditionId!)
    else onToggleConditionLogicalOperator?.(caseId)
  }, [
    caseId,
    conditionId,
    isSubVariable,
    onToggleConditionLogicalOperator,
    onToggleSubVariableConditionLogicalOperator,
  ])

  const isValueFieldShort = useMemo(() => {
    if (isSubVariable && conditions.length > 1) return true

    return false
  }, [conditions.length, isSubVariable])
  const conditionItemClassName = useMemo(() => {
    if (!isSubVariable) return ''
    if (conditions.length < 2) return ''
    return logical_operator === LogicalOperator.and ? 'pl-[51px]' : 'pl-[42px]'
  }, [conditions.length, isSubVariable, logical_operator])

  return (
    <div className={cn('relative', !isSubVariable && 'ps-15')}>
      {conditions.length > 1 && (
        <div
          className={cn(
            'absolute inset-s-0 top-0 bottom-0 w-15',
            isSubVariable && logical_operator === LogicalOperator.and && '-inset-s-2.5',
            isSubVariable && logical_operator === LogicalOperator.or && '-inset-s-4.5',
          )}
        >
          <div className="absolute inset-s-11.5 top-4 bottom-4 w-2.5 rounded-s-lg border border-e-0 border-divider-deep"></div>
          <div className="absolute inset-e-0 top-1/2 h-7.25 w-4 -translate-y-1/2 bg-components-panel-bg"></div>
          <div
            className="absolute inset-e-1 top-1/2 flex h-5.25 -translate-y-1/2 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1 text-2xs font-semibold text-text-accent-secondary shadow-xs select-none"
            onClick={doToggleConditionLogicalOperator}
          >
            {logical_operator.toUpperCase()}
            <RiLoopLeftLine className="ms-0.5 size-3" />
          </div>
        </div>
      )}
      {caseItem.conditions.map((condition) => (
        <ConditionItem
          key={condition.id}
          className={conditionItemClassName}
          disabled={disabled}
          caseId={caseId}
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
          nodesOutputVars={nodesOutputVars}
          availableNodes={availableNodes}
          filterVar={filterVar}
          numberVariables={numberVariables}
          file={
            varsIsVarFileAttribute[condition.id]
              ? { key: (condition.variable_selector || []).slice(-1)[0]! }
              : undefined
          }
          isSubVariableKey={isSubVariable}
        />
      ))}
    </div>
  )
}

export default ConditionList
