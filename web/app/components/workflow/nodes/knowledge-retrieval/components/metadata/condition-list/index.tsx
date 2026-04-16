import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiLoopLeftLine } from '@remixicon/react'
import { LogicalOperator } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import ConditionItem from './condition-item'

type ConditionListProps = {
  disabled?: boolean
} & Omit<MetadataShape, 'handleAddCondition'>

const ConditionList = ({
  disabled,
  metadataList = [],
  metadataFilteringConditions = {
    conditions: [],
    logical_operator: LogicalOperator.and,
  },
  handleRemoveCondition,
  handleToggleConditionLogicalOperator,
  handleUpdateCondition,
  availableStringVars,
  availableStringNodesWithParent,
  availableNumberVars,
  availableNumberNodesWithParent,
  isCommonVariable,
  availableCommonNumberVars,
  availableCommonStringVars,
}: ConditionListProps) => {
  const { conditions, logical_operator } = metadataFilteringConditions

  return (
    <div className={cn('relative')}>
      {
        conditions.length > 1 && (
          <div className={cn(
            'absolute top-0 bottom-0 left-0 w-[44px]',
          )}
          >
            <div className="absolute top-4 right-1 bottom-4 w-2.5 rounded-l-[8px] border border-r-0 border-divider-deep"></div>
            <div className="absolute top-1/2 right-0 h-[29px] w-4 -translate-y-1/2 bg-components-panel-bg"></div>
            <div
              className="absolute top-1/2 right-1 flex h-[21px] -translate-y-1/2 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1 text-[10px] font-semibold text-text-accent-secondary shadow-xs select-none"
              onClick={() => handleToggleConditionLogicalOperator()}
            >
              {logical_operator.toUpperCase()}
              <RiLoopLeftLine className="ml-0.5 h-3 w-3" />
            </div>
          </div>
        )
      }
      <div className={cn(conditions.length > 1 && 'pl-[44px]')}>
        {
          conditions.map(condition => (
            <ConditionItem
              key={`${condition.id}`}
              disabled={disabled}
              condition={condition}
              onUpdateCondition={handleUpdateCondition}
              onRemoveCondition={handleRemoveCondition}
              metadataList={metadataList}
              availableStringVars={availableStringVars}
              availableStringNodesWithParent={availableStringNodesWithParent}
              availableNumberVars={availableNumberVars}
              availableNumberNodesWithParent={availableNumberNodesWithParent}
              isCommonVariable={isCommonVariable}
              availableCommonStringVars={availableCommonStringVars}
              availableCommonNumberVars={availableCommonNumberVars}
            />
          ))
        }
      </div>
    </div>
  )
}

export default ConditionList
