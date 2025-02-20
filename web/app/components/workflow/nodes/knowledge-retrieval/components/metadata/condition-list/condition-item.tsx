import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import { comparisonOperatorNotRequireValue } from './utils'
import ConditionOperator from './condition-operator'
import ConditionValueMethod from './condition-value-method'
import ConditionString from './condition-string'
import ConditionNumber from './condition-number'
import ConditionDate from './condition-date'
import { useCondition } from './hooks'
import type {
  HandleRemoveCondition,
  HandleUpdateCondition,
  MetadataFilteringCondition,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type ConditionItemProps = {
  index: number
  className?: string
  disabled?: boolean
  condition: MetadataFilteringCondition // condition may the condition of case or condition of sub variable
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
}
const ConditionItem = ({
  index,
  className,
  disabled,
  condition,
  onRemoveCondition,
}: ConditionItemProps) => {
  const [isHovered, setIsHovered] = useState(false)
  const { getConditionVariableType } = useCondition()

  const canChooseOperator = useMemo(() => {
    if (disabled)
      return false

    return true
  }, [disabled])

  const doRemoveCondition = useCallback(() => {
    onRemoveCondition?.(index)
  }, [onRemoveCondition, index])

  return (
    <div className={cn('flex mb-1 last-of-type:mb-0', className)}>
      <div className={cn(
        'grow bg-components-input-bg-normal rounded-lg',
        isHovered && 'bg-state-destructive-hover',
      )}>
        <div className='flex items-center p-1'>
          <div className='grow w-0'>
            <div className='inline-flex items-center h-6 border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark rounded-md shadow-xs'>
              <div className='mr-0.5 system-xs-medium text-text-secondary'>Language</div>
              <div className='system-xs-regular text-text-tertiary'>string</div>
            </div>
          </div>
          <div className='mx-1 w-[1px] h-3 bg-divider-regular'></div>
          <ConditionOperator
            disabled={!canChooseOperator}
            variableType={MetadataFilteringVariableType.string}
            value={condition.comparison_operator}
            onSelect={() => {}}
          />
        </div>
        <div className='flex items-center pl-1 pr-2 h-8'>
          <ConditionValueMethod
            valueMethod='variable'
            onValueMethodChange={() => {}}
          />
          <div className='ml-1 mr-1.5 w-[1px] h-4 bg-divider-regular'></div>
        </div>
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && getConditionVariableType(condition.name) === MetadataFilteringVariableType.string && (
            <ConditionString
              onValueMethodChange={() => {}}
            />
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && getConditionVariableType(condition.name) === MetadataFilteringVariableType.number && (
            <ConditionNumber
              onValueMethodChange={() => {}}
            />
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && getConditionVariableType(condition.name) === MetadataFilteringVariableType.date && (
            <ConditionDate
              value=''
              onChange={() => {}}
            />
          )
        }
      </div>
      <div
        className='shrink-0 flex items-center justify-center ml-1 mt-1 w-6 h-6 rounded-lg cursor-pointer hover:bg-state-destructive-hover text-text-tertiary hover:text-text-destructive'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={doRemoveCondition}
      >
        <RiDeleteBinLine className='w-4 h-4' />
      </div>
    </div>
  )
}

export default ConditionItem
