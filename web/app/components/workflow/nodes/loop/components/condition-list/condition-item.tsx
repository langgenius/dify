import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine } from '@remixicon/react'
import produce from 'immer'
import type { VarType as NumberVarType } from '../../../tool/types'
import type {
  Condition,
  HandleAddSubVariableCondition,
  HandleRemoveCondition,
  HandleToggleSubVariableConditionLogicalOperator,
  HandleUpdateCondition,
  HandleUpdateSubVariableCondition,
  handleRemoveSubVariableCondition,
} from '../../types'
import {
  ComparisonOperator,
} from '../../types'
import ConditionNumberInput from '../condition-number-input'
import ConditionWrap from '../condition-wrap'
import { comparisonOperatorNotRequireValue, getOperators } from './../../utils'
import ConditionOperator from './condition-operator'
import ConditionInput from './condition-input'
import { FILE_TYPE_OPTIONS, SUB_VARIABLES, TRANSFER_METHOD } from './../../default'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { SimpleSelect as Select } from '@/app/components/base/select'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import ConditionVarSelector from './condition-var-selector'

const optionNameI18NPrefix = 'workflow.nodes.ifElse.optionName'

type ConditionItemProps = {
  className?: string
  disabled?: boolean
  conditionId: string // in isSubVariableKey it's the value of the parent condition's id
  condition: Condition // condition may the condition of case or condition of sub variable
  file?: { key: string }
  isSubVariableKey?: boolean
  isValueFieldShort?: boolean
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  onAddSubVariableCondition?: HandleAddSubVariableCondition
  onRemoveSubVariableCondition?: handleRemoveSubVariableCondition
  onUpdateSubVariableCondition?: HandleUpdateSubVariableCondition
  onToggleSubVariableConditionLogicalOperator?: HandleToggleSubVariableConditionLogicalOperator
  nodeId: string
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
  availableVars: NodeOutPutVar[]
}
const ConditionItem = ({
  className,
  disabled,
  conditionId,
  condition,
  file,
  isSubVariableKey,
  isValueFieldShort,
  onRemoveCondition,
  onUpdateCondition,
  onAddSubVariableCondition,
  onRemoveSubVariableCondition,
  onUpdateSubVariableCondition,
  onToggleSubVariableConditionLogicalOperator,
  nodeId,
  availableNodes,
  numberVariables,
  availableVars,
}: ConditionItemProps) => {
  const { t } = useTranslation()

  const [isHovered, setIsHovered] = useState(false)
  const [open, setOpen] = useState(false)

  const doUpdateCondition = useCallback((newCondition: Condition) => {
    if (isSubVariableKey)
      onUpdateSubVariableCondition?.(conditionId, condition.id, newCondition)
    else
      onUpdateCondition?.(condition.id, newCondition)
  }, [condition, conditionId, isSubVariableKey, onUpdateCondition, onUpdateSubVariableCondition])

  const canChooseOperator = useMemo(() => {
    if (disabled)
      return false

    if (isSubVariableKey)
      return !!condition.key

    return true
  }, [condition.key, disabled, isSubVariableKey])
  const handleUpdateConditionOperator = useCallback((value: ComparisonOperator) => {
    const newCondition = {
      ...condition,
      comparison_operator: value,
    }
    doUpdateCondition(newCondition)
  }, [condition, doUpdateCondition])

  const handleUpdateConditionNumberVarType = useCallback((numberVarType: NumberVarType) => {
    const newCondition = {
      ...condition,
      numberVarType,
      value: '',
    }
    doUpdateCondition(newCondition)
  }, [condition, doUpdateCondition])

  const isSubVariable = condition.varType === VarType.arrayFile && [ComparisonOperator.contains, ComparisonOperator.notContains, ComparisonOperator.allOf].includes(condition.comparison_operator!)
  const fileAttr = useMemo(() => {
    if (file)
      return file
    if (isSubVariableKey) {
      return {
        key: condition.key!,
      }
    }
    return undefined
  }, [condition.key, file, isSubVariableKey])

  const isArrayValue = fileAttr?.key === 'transfer_method' || fileAttr?.key === 'type'

  const handleUpdateConditionValue = useCallback((value: string) => {
    if (value === condition.value || (isArrayValue && value === condition.value?.[0]))
      return
    const newCondition = {
      ...condition,
      value: isArrayValue ? [value] : value,
    }
    doUpdateCondition(newCondition)
  }, [condition, doUpdateCondition, isArrayValue])

  const isSelect = condition.comparison_operator && [ComparisonOperator.in, ComparisonOperator.notIn].includes(condition.comparison_operator)
  const selectOptions = useMemo(() => {
    if (isSelect) {
      if (fileAttr?.key === 'type' || condition.comparison_operator === ComparisonOperator.allOf) {
        return FILE_TYPE_OPTIONS.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`),
          value: item.value,
        }))
      }
      if (fileAttr?.key === 'transfer_method') {
        return TRANSFER_METHOD.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`),
          value: item.value,
        }))
      }
      return []
    }
    return []
  }, [condition.comparison_operator, fileAttr?.key, isSelect, t])

  const isNotInput = isSelect || isSubVariable

  const isSubVarSelect = isSubVariableKey
  const subVarOptions = SUB_VARIABLES.map(item => ({
    name: item,
    value: item,
  }))

  const handleSubVarKeyChange = useCallback((key: string) => {
    const newCondition = produce(condition, (draft) => {
      draft.key = key
      if (key === 'size')
        draft.varType = VarType.number
      else
        draft.varType = VarType.string

      draft.value = ''
      draft.comparison_operator = getOperators(undefined, { key })[0]
    })

    onUpdateSubVariableCondition?.(conditionId, condition.id, newCondition)
  }, [condition, conditionId, onUpdateSubVariableCondition])

  const doRemoveCondition = useCallback(() => {
    if (isSubVariableKey)
      onRemoveSubVariableCondition?.(conditionId, condition.id)
    else
      onRemoveCondition?.(condition.id)
  }, [condition, conditionId, isSubVariableKey, onRemoveCondition, onRemoveSubVariableCondition])

  const handleVarChange = useCallback((valueSelector: ValueSelector, varItem: Var) => {
    const newCondition = produce(condition, (draft) => {
      draft.variable_selector = valueSelector
      draft.varType = varItem.type
      draft.value = ''
      draft.comparison_operator = getOperators(varItem.type)[0]
    })
    doUpdateCondition(newCondition)
    setOpen(false)
  }, [condition, doUpdateCondition])

  return (
    <div className={cn('flex mb-1 last-of-type:mb-0', className)}>
      <div className={cn(
        'grow bg-components-input-bg-normal rounded-lg',
        isHovered && 'bg-state-destructive-hover',
      )}>
        <div className='flex items-center p-1'>
          <div className='grow w-0'>
            {isSubVarSelect
              ? (
                <Select
                  wrapperClassName='h-6'
                  className='pl-0 text-xs'
                  optionWrapClassName='w-[165px] max-h-none'
                  defaultValue={condition.key}
                  items={subVarOptions}
                  onSelect={item => handleSubVarKeyChange(item.value as string)}
                  renderTrigger={item => (
                    item
                      ? <div className='flex justify-start cursor-pointer'>
                        <div className='inline-flex max-w-full px-1.5 items-center h-6 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark shadow-xs text-text-accent'>
                          <Variable02 className='shrink-0 w-3.5 h-3.5 text-text-accent' />
                          <div className='ml-0.5 truncate system-xs-medium'>{item?.name}</div>
                        </div>
                      </div>
                      : <div className='text-left text-components-input-text-placeholder system-sm-regular'>{t('common.placeholder.select')}</div>
                  )}
                  hideChecked
                />
              )
              : (
                <ConditionVarSelector
                  open={open}
                  onOpenChange={setOpen}
                  valueSelector={condition.variable_selector || []}
                  varType={condition.varType}
                  availableNodes={availableNodes}
                  nodesOutputVars={availableVars}
                  onChange={handleVarChange}
                />
              )}

          </div>
          <div className='mx-1 w-[1px] h-3 bg-divider-regular'></div>
          <ConditionOperator
            disabled={!canChooseOperator}
            varType={condition.varType}
            value={condition.comparison_operator}
            onSelect={handleUpdateConditionOperator}
            file={fileAttr}
          />
        </div>
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && !isNotInput && condition.varType !== VarType.number && (
            <div className='px-2 py-1 max-h-[100px] border-t border-t-divider-subtle overflow-y-auto'>
              <ConditionInput
                disabled={disabled}
                value={condition.value as string}
                onChange={handleUpdateConditionValue}
                availableNodes={availableNodes}
              />
            </div>
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && !isNotInput && condition.varType === VarType.number && (
            <div className='px-2 py-1 pt-[3px] border-t border-t-divider-subtle'>
              <ConditionNumberInput
                numberVarType={condition.numberVarType}
                onNumberVarTypeChange={handleUpdateConditionNumberVarType}
                value={condition.value as string}
                onValueChange={handleUpdateConditionValue}
                variables={numberVariables}
                isShort={isValueFieldShort}
                unit={fileAttr?.key === 'size' ? 'Byte' : undefined}
              />
            </div>
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && isSelect && (
            <div className='border-t border-t-divider-subtle'>
              <Select
                wrapperClassName='h-8'
                className='px-2 text-xs rounded-t-none'
                defaultValue={isArrayValue ? (condition.value as string[])?.[0] : (condition.value as string)}
                items={selectOptions}
                onSelect={item => handleUpdateConditionValue(item.value as string)}
                hideChecked
                notClearable
              />
            </div>
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && isSubVariable && (
            <div className='p-1'>
              <ConditionWrap
                isSubVariable
                conditions={condition.sub_variable_condition?.conditions || []}
                logicalOperator={condition.sub_variable_condition?.logical_operator}
                conditionId={conditionId}
                readOnly={!!disabled}
                handleAddSubVariableCondition={onAddSubVariableCondition}
                handleRemoveSubVariableCondition={onRemoveSubVariableCondition}
                handleUpdateSubVariableCondition={onUpdateSubVariableCondition}
                handleToggleSubVariableConditionLogicalOperator={onToggleSubVariableConditionLogicalOperator}
                nodeId={nodeId}
                availableNodes={availableNodes}
                availableVars={availableVars}
              />
            </div>
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
