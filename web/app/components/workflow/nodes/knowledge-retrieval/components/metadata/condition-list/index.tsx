import { RiLoopLeftLine } from '@remixicon/react'
import ConditionItem from './condition-item'
import cn from '@/utils/classnames'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { LogicalOperator } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

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
          )}>
            <div className='absolute top-4 bottom-4 right-1 w-2.5 border border-divider-deep rounded-l-[8px] border-r-0'></div>
            <div className='absolute top-1/2 -translate-y-1/2 right-0 w-4 h-[29px] bg-components-panel-bg'></div>
            <div
              className='absolute top-1/2 right-1 -translate-y-1/2 flex items-center px-1 h-[21px] rounded-md border-[0.5px] border-components-button-secondary-border shadow-xs bg-components-button-secondary-bg text-text-accent-secondary text-[10px] font-semibold cursor-pointer select-none'
              onClick={() => handleToggleConditionLogicalOperator()}
            >
              {logical_operator.toUpperCase()}
              <RiLoopLeftLine className='ml-0.5 w-3 h-3' />
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
