import type {
  ComparisonOperator,
  HandleRemoveCondition,
  HandleUpdateCondition,
  MetadataFilteringCondition,
  MetadataShape,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RiDeleteBinLine } from '@remixicon/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import MetadataIcon from '../metadata-icon'
import ConditionDate from './condition-date'
import ConditionNumber from './condition-number'
import ConditionOperator from './condition-operator'
import ConditionString from './condition-string'
import { COMMON_VARIABLE_REGEX, comparisonOperatorNotRequireValue, VARIABLE_REGEX } from './utils'

type ConditionItemProps = {
  className?: string
  disabled?: boolean
  condition: MetadataFilteringCondition // condition may the condition of case or condition of sub variable
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
} & Pick<
  MetadataShape,
  | 'metadataList'
  | 'availableStringVars'
  | 'availableStringNodesWithParent'
  | 'availableNumberVars'
  | 'availableNumberNodesWithParent'
  | 'isCommonVariable'
  | 'availableCommonStringVars'
  | 'availableCommonNumberVars'
>
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
  const { t } = useTranslation(['common'])
  const [isHovered, setIsHovered] = useState(false)

  const canChooseOperator = useMemo(() => {
    if (disabled) return false

    return true
  }, [disabled])

  const doRemoveCondition = useCallback(() => {
    if (!disabled) onRemoveCondition?.(condition.id)
  }, [onRemoveCondition, condition.id, disabled])

  const currentMetadata = useMemo(() => {
    if (condition.metadata_id) {
      const foundByIdAndName = metadataList.find(
        (metadata) => metadata.id === condition.metadata_id && metadata.name === condition.name,
      )
      if (foundByIdAndName) return foundByIdAndName

      const foundById = metadataList.filter((metadata) => metadata.id === condition.metadata_id)
      if (foundById.length === 1) return foundById[0]
    }

    return metadataList.find((metadata) => metadata.name === condition.name)
  }, [metadataList, condition.metadata_id, condition.name])

  const handleConditionOperatorChange = useCallback(
    (operator: ComparisonOperator) => {
      if (disabled) return
      onUpdateCondition?.(condition.id, {
        ...condition,
        value: comparisonOperatorNotRequireValue(condition.comparison_operator)
          ? undefined
          : condition.value,
        comparison_operator: operator,
      })
    },
    [onUpdateCondition, condition, disabled],
  )

  const valueAndValueMethod = useMemo(() => {
    if (
      (currentMetadata?.type === MetadataFilteringVariableType.string ||
        currentMetadata?.type === MetadataFilteringVariableType.number) &&
      typeof condition.value === 'string'
    ) {
      const regex = isCommonVariable ? COMMON_VARIABLE_REGEX : VARIABLE_REGEX
      const matchedStartNumber = isCommonVariable ? 2 : 3
      const matched = condition.value.match(regex)

      if (matched?.length) {
        return {
          value: matched[0].slice(matchedStartNumber, -matchedStartNumber),
          valueMethod: 'variable',
        }
      } else {
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

  const handleValueMethodChange = useCallback(
    (v: string) => {
      if (disabled) return
      setLocalValueMethod(v)
      onUpdateCondition?.(condition.id, { ...condition, value: undefined })
    },
    [condition, onUpdateCondition, disabled],
  )

  const handleValueChange = useCallback(
    (v: any) => {
      if (disabled) return
      onUpdateCondition?.(condition.id, { ...condition, value: v })
    },
    [condition, onUpdateCondition, disabled],
  )

  return (
    <fieldset
      disabled={disabled}
      className={cn('mb-1 flex min-w-0 border-0 p-0 last-of-type:mb-0', className)}
    >
      <div
        className={cn(
          'grow rounded-lg bg-components-input-bg-normal',
          isHovered && 'bg-state-destructive-hover',
        )}
      >
        <div className="flex items-center p-1">
          <div className="w-0 grow">
            <div className="flex h-6 min-w-0 items-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark pr-1.5 pl-1 shadow-xs">
              <div className="mr-0.5 p-px">
                <MetadataIcon type={currentMetadata?.type} className="size-3" />
              </div>
              <div className="mr-0.5 min-w-0 flex-1 truncate system-xs-medium text-text-secondary">
                {currentMetadata?.name}
              </div>
              <div className="system-xs-regular text-text-tertiary">{currentMetadata?.type}</div>
            </div>
          </div>
          <div className="mx-1 h-3 w-px bg-divider-regular"></div>
          <ConditionOperator
            disabled={!canChooseOperator}
            variableType={currentMetadata?.type || MetadataFilteringVariableType.string}
            value={condition.comparison_operator}
            onSelect={handleConditionOperatorChange}
          />
        </div>
        <div className="border-t border-t-divider-subtle">
          {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
            currentMetadata?.type === MetadataFilteringVariableType.string && (
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
            )}
          {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
            currentMetadata?.type === MetadataFilteringVariableType.number && (
              <ConditionNumber
                valueMethod={localValueMethod}
                onValueMethodChange={handleValueMethodChange}
                nodesOutputVars={availableNumberVars}
                availableNodes={availableNumberNodesWithParent}
                value={
                  typeof valueAndValueMethod.value === 'string' ||
                  typeof valueAndValueMethod.value === 'number'
                    ? valueAndValueMethod.value
                    : undefined
                }
                onChange={handleValueChange}
                isCommonVariable={isCommonVariable}
                commonVariables={availableCommonNumberVars}
              />
            )}
          {!comparisonOperatorNotRequireValue(condition.comparison_operator) &&
            currentMetadata?.type === MetadataFilteringVariableType.time && (
              <ConditionDate
                disabled={disabled}
                value={condition.value as number}
                onChange={handleValueChange}
              />
            )}
        </div>
      </div>
      <IconButton
        className="mt-1 ml-1 shrink-0"
        aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
        disabled={disabled}
        tone="destructive"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={doRemoveCondition}
      >
        <RiDeleteBinLine aria-hidden className="size-4" />
      </IconButton>
    </fieldset>
  )
}

export default ConditionItem
