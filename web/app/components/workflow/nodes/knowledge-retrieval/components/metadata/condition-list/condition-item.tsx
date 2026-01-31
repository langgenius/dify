import type {
  ComparisonOperator,
  HandleRemoveCondition,
  HandleUpdateCondition,
  MetadataFilteringCondition,
  MetadataShape,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { cn } from '@/utils/classnames'
import MetadataIcon from '../metadata-icon'
import ConditionDate from './condition-date'
import ConditionNumber from './condition-number'
import ConditionOperator from './condition-operator'
import ConditionString from './condition-string'
import {
  COMMON_VARIABLE_REGEX,
  comparisonOperatorNotRequireValue,
  VARIABLE_REGEX,
} from './utils'

type ConditionItemProps = {
  className?: string
  disabled?: boolean
  condition: MetadataFilteringCondition // condition may the condition of case or condition of sub variable
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
} & Pick<MetadataShape, 'metadataList' | 'availableStringVars' | 'availableStringNodesWithParent' | 'availableNumberVars' | 'availableNumberNodesWithParent' | 'isCommonVariable' | 'availableCommonStringVars' | 'availableCommonNumberVars'>
const ConditionItem = ({
  className,
  disabled,
  condition,
  onRemoveCondition,
  onUpdateCondition,
  metadataList = [],
  availableStringVars = [],
  availableStringNodesWithParent = [],
  availableNumberVars = [],
  availableNumberNodesWithParent = [],
  isCommonVariable,
  availableCommonStringVars = [],
  availableCommonNumberVars = [],
}: ConditionItemProps) => {
  const [isHovered, setIsHovered] = useState(false)

  const canChooseOperator = useMemo(() => {
    if (disabled)
      return false

    return true
  }, [disabled])

  const doRemoveCondition = useCallback(() => {
    onRemoveCondition?.(condition.id)
  }, [onRemoveCondition, condition.id])

  const currentMetadata = useMemo(() => {
    // Try to match by metadata_id first (reliable reference)
    if (condition.metadata_id) {
      const found = metadataList.find(metadata => metadata.id === condition.metadata_id)
      if (found)
        return found
    }
    // Fallback to name matching for backward compatibility with old conditions
    return metadataList.find(metadata => metadata.name === condition.name)
  }, [metadataList, condition.metadata_id, condition.name])

  const handleConditionOperatorChange = useCallback((operator: ComparisonOperator) => {
    onUpdateCondition?.(
      condition.id,
      {
        ...condition,
        value: comparisonOperatorNotRequireValue(condition.comparison_operator) ? undefined : condition.value,
        comparison_operator: operator,
      },
    )
  }, [onUpdateCondition, condition])

  const valueAndValueMethod = useMemo(() => {
    if (
      (currentMetadata?.type === MetadataFilteringVariableType.string
        || currentMetadata?.type === MetadataFilteringVariableType.number
        || currentMetadata?.type === MetadataFilteringVariableType.select)
      && typeof condition.value === 'string'
    ) {
      const regex = isCommonVariable ? COMMON_VARIABLE_REGEX : VARIABLE_REGEX
      const matchedStartNumber = isCommonVariable ? 2 : 3
      const matched = condition.value.match(regex)

      if (matched?.length) {
        return {
          value: matched[0].slice(matchedStartNumber, -matchedStartNumber),
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
  }, [currentMetadata, condition.value, isCommonVariable])
  const [localValueMethod, setLocalValueMethod] = useState(valueAndValueMethod.valueMethod)

  const handleValueMethodChange = useCallback((v: string) => {
    setLocalValueMethod(v)
    onUpdateCondition?.(condition.id, { ...condition, value: undefined })
  }, [condition, onUpdateCondition])

  const handleValueChange = useCallback((v: any) => {
    onUpdateCondition?.(condition.id, { ...condition, value: v })
  }, [condition, onUpdateCondition])

  return (
    <div className={cn('mb-1 flex last-of-type:mb-0', className)}>
      <div className={cn(
        'grow rounded-lg bg-components-input-bg-normal',
        isHovered && 'bg-state-destructive-hover',
      )}
      >
        <div className="flex items-center p-1">
          <div className="w-0 grow">
            <div className="flex h-6 min-w-0 items-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark pl-1 pr-1.5 shadow-xs">
              <div className="mr-0.5 p-[1px]">
                <MetadataIcon type={currentMetadata?.type} className="h-3 w-3" />
              </div>
              <div className="system-xs-medium mr-0.5 min-w-0 flex-1 truncate text-text-secondary">{currentMetadata?.name}</div>
              <div className="system-xs-regular text-text-tertiary">{currentMetadata?.type}</div>
            </div>
          </div>
          <div className="mx-1 h-3 w-[1px] bg-divider-regular"></div>
          <ConditionOperator
            disabled={!canChooseOperator}
            variableType={currentMetadata?.type || MetadataFilteringVariableType.string}
            value={condition.comparison_operator}
            onSelect={handleConditionOperatorChange}
          />
        </div>
        <div className="border-t border-t-divider-subtle">
          {
            !comparisonOperatorNotRequireValue(condition.comparison_operator)
            && (currentMetadata?.type === MetadataFilteringVariableType.string
              || currentMetadata?.type === MetadataFilteringVariableType.select) && (
              <ConditionString
                valueMethod={localValueMethod}
                onValueMethodChange={handleValueMethodChange}
                nodesOutputVars={availableStringVars}
                availableNodes={availableStringNodesWithParent}
                value={valueAndValueMethod.value as string}
                onChange={handleValueChange}
                isCommonVariable={isCommonVariable}
                commonVariables={availableCommonStringVars}
              />
            )
          }
          {
            !comparisonOperatorNotRequireValue(condition.comparison_operator) && currentMetadata?.type === MetadataFilteringVariableType.number && (
              <ConditionNumber
                valueMethod={localValueMethod}
                onValueMethodChange={handleValueMethodChange}
                nodesOutputVars={availableNumberVars}
                availableNodes={availableNumberNodesWithParent}
                value={valueAndValueMethod.value}
                onChange={handleValueChange}
                isCommonVariable={isCommonVariable}
                commonVariables={availableCommonNumberVars}
              />
            )
          }
          {
            !comparisonOperatorNotRequireValue(condition.comparison_operator) && currentMetadata?.type === MetadataFilteringVariableType.time && (
              <ConditionDate
                value={condition.value as number}
                onChange={handleValueChange}
              />
            )
          }
        </div>
      </div>
      <div
        className="ml-1 mt-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={doRemoveCondition}
      >
        <RiDeleteBinLine className="h-4 w-4" />
      </div>
    </div>
  )
}

export default ConditionItem
