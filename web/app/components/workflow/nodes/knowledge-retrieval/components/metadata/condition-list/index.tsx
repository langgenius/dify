import { RiLoopLeftLine } from '@remixicon/react'
import { useMemo } from 'react'
import ConditionItem from './condition-item'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { LogicalOperator } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

type ConditionListProps = {
  disabled?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
} & Omit<MetadataShape, 'handleAddCondition'>
const ConditionList = ({
  disabled,
  metadataFilteringConditions,
  handleRemoveCondition,
  handleToggleConditionLogicalOperator,
  handleUpdateCondition,
  nodesOutputVars = [],
  availableNodes = [],
}: ConditionListProps) => {
  const { conditions, logical_operator } = metadataFilteringConditions

  const conditionItemClassName = useMemo(() => {
    if (conditions.length < 2)
      return ''
    return logical_operator === LogicalOperator.and ? 'pl-[51px]' : 'pl-[42px]'
  }, [conditions.length, logical_operator])

  return (
    <div className={cn('relative')}>
      {
        conditions.length > 1 && (
          <div className={cn(
            'absolute top-0 bottom-0 left-0 w-[60px]',
          )}>
            <div className='absolute top-4 bottom-4 left-[46px] w-2.5 border border-divider-deep rounded-l-[8px] border-r-0'></div>
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
      {
        conditions.map((condition, index) => (
          <ConditionItem
            key={index}
            className={conditionItemClassName}
            disabled={disabled}
            condition={condition}
            onUpdateCondition={handleUpdateCondition}
            onRemoveCondition={handleRemoveCondition}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
          />
        ))
      }
    </div>
  )
}

export default ConditionList
