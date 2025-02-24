import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import {
  VARIABLE_REGEX,
  comparisonOperatorNotRequireValue,
} from './utils'
import ConditionOperator from './condition-operator'
import ConditionString from './condition-string'
import ConditionNumber from './condition-number'
import ConditionDate from './condition-date'
import { useCondition } from './hooks'
import type {
  ComparisonOperator,
  HandleRemoveCondition,
  HandleUpdateCondition,
  MetadataFilteringCondition,
  MetadataShape,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type ConditionItemProps = {
  className?: string
  disabled?: boolean
  condition: MetadataFilteringCondition // condition may the condition of case or condition of sub variable
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
} & Pick<MetadataShape, 'metadataList'>
const ConditionItem = ({
  className,
  disabled,
  condition,
  onRemoveCondition,
  onUpdateCondition,
  metadataList = [],
  nodesOutputVars,
  availableNodes,
}: ConditionItemProps) => {
  const [isHovered, setIsHovered] = useState(false)
  const { getConditionVariableType } = useCondition()

  const canChooseOperator = useMemo(() => {
    if (disabled)
      return false

    return true
  }, [disabled])

  const doRemoveCondition = useCallback(() => {
    onRemoveCondition?.(condition.name)
  }, [onRemoveCondition, condition.name])

  const currentMetadata = useMemo(() => {
    return metadataList.find(metadata => metadata.name === condition.name)
  }, [metadataList, condition.name])

  const handleConditionOperatorChange = useCallback((operator: ComparisonOperator) => {
    onUpdateCondition?.(condition.name, { ...condition, comparison_operator: operator })
  }, [onUpdateCondition, condition])

  const valueAndValueMethod = useMemo(() => {
    if (
      (currentMetadata?.type === MetadataFilteringVariableType.string || currentMetadata?.type === MetadataFilteringVariableType.number)
      && typeof condition.value === 'string'
    ) {
      const matched = condition.value.match(VARIABLE_REGEX)

      if (matched?.length) {
        return {
          value: matched[0].slice(3, -3),
          valueMethod: 'variable',
        }
      }
      else {
        return {
          value: condition.value,
          valueMethod: 'constant',
        }
      }
    }

    return {
      value: condition.value,
      valueMethod: 'constant',
    }
  }, [currentMetadata, condition.value])
  const [localValueMethod, setLocalValueMethod] = useState(valueAndValueMethod.value)

  const handleValueMethodChange = useCallback((v: string) => {
    setLocalValueMethod(v)
    onUpdateCondition?.(condition.name, { ...condition, value: undefined })
  }, [condition, onUpdateCondition])

  const handleValueChange = useCallback((v: any) => {
    onUpdateCondition?.(condition.name, { ...condition, value: v })
  }, [condition, onUpdateCondition])

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
            variableType={currentMetadata!.type}
            value={condition.comparison_operator}
            onSelect={handleConditionOperatorChange}
          />
        </div>
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && getConditionVariableType(condition.name) === MetadataFilteringVariableType.string && (
            <ConditionString
              valueMethod={localValueMethod}
              onValueMethodChange={handleValueMethodChange}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
              value={valueAndValueMethod.value}
              onChange={handleValueChange}
            />
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && getConditionVariableType(condition.name) === MetadataFilteringVariableType.number && (
            <ConditionNumber
              valueMethod={localValueMethod}
              onValueMethodChange={handleValueMethodChange}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
              value={valueAndValueMethod.value}
              onChange={handleValueChange}
            />
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && getConditionVariableType(condition.name) === MetadataFilteringVariableType.date && (
            <ConditionDate
              value={condition.value}
              onChange={handleValueChange}
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
