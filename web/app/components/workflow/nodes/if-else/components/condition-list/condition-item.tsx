import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine } from '@remixicon/react'
import produce from 'immer'
import { XMarkIcon } from '@heroicons/react/20/solid'
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
import { comparisonOperatorNotRequireValue } from '../../utils'
import ConditionNumberInput from '../condition-number-input'
import { FILE_TYPE_OPTIONS, SUB_VARIABLES, TRANSFER_METHOD } from '../../default'
import ConditionWrap from '../condition-wrap'
import ConditionOperator from './condition-operator'
import ConditionInput from './condition-input'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { SimpleSelect as Select } from '@/app/components/base/select'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
const optionNameI18NPrefix = 'workflow.nodes.ifElse.optionName'

type ConditionItemProps = {
  disabled?: boolean
  caseId: string
  conditionId: string // in isSubVariableKey it's the value of the parent condition's id
  condition: Condition // condition may the condition of case or condition of sub variable
  file?: { key: string }
  isSubVariableKey?: boolean
  subVariableKeyCaseId?: string
  onRemoveCondition?: HandleRemoveCondition
  onUpdateCondition?: HandleUpdateCondition
  onAddSubVariableCondition?: HandleAddSubVariableCondition
  onRemoveSubVariableCondition?: handleRemoveSubVariableCondition
  onUpdateSubVariableCondition?: HandleUpdateSubVariableCondition
  onToggleSubVariableConditionLogicalOperator?: HandleToggleSubVariableConditionLogicalOperator
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  numberVariables: NodeOutPutVar[]
}
const ConditionItem = ({
  disabled,
  caseId,
  conditionId,
  condition,
  file,
  isSubVariableKey,
  onRemoveCondition,
  onUpdateCondition,
  onAddSubVariableCondition,
  onRemoveSubVariableCondition,
  onUpdateSubVariableCondition,
  onToggleSubVariableConditionLogicalOperator,
  nodesOutputVars,
  availableNodes,
  numberVariables,
}: ConditionItemProps) => {
  const { t } = useTranslation()

  const [isHovered, setIsHovered] = useState(false)

  const doUpdateCondition = useCallback((newCondition: Condition) => {
    if (isSubVariableKey)
      onUpdateSubVariableCondition?.(caseId, conditionId, condition.id, newCondition)
    else
      onUpdateCondition?.(caseId, condition.id, newCondition)
  }, [caseId, condition, conditionId, isSubVariableKey, onUpdateCondition, onUpdateSubVariableCondition])

  const handleUpdateConditionOperator = useCallback((value: ComparisonOperator) => {
    const newCondition = {
      ...condition,
      comparison_operator: value,
    }
    doUpdateCondition(newCondition)
  }, [condition, doUpdateCondition])

  const handleUpdateConditionValue = useCallback((value: string) => {
    const newCondition = {
      ...condition,
      value,
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

  const isSelect = condition.comparison_operator && [ComparisonOperator.in, ComparisonOperator.notIn, ComparisonOperator.allOf].includes(condition.comparison_operator)
  const selectOptions = useMemo(() => {
    if (isSelect) {
      if (file?.key === 'type' || condition.comparison_operator === ComparisonOperator.allOf) {
        return FILE_TYPE_OPTIONS.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`),
          value: item.value,
        }))
      }
      if (file?.key === 'transfer_method') {
        return TRANSFER_METHOD.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`),
          value: item.value,
        }))
      }
      return []
    }
    return []
  }, [condition.comparison_operator, file?.key, isSelect, t])

  const isSubVariable = condition.varType === VarType.arrayFile && [ComparisonOperator.contains, ComparisonOperator.notContains].includes(condition.comparison_operator!)
  const isNotInput = isSelect || isSubVariable

  const isSubVarSelect = isSubVariableKey
  const subVarOptions = SUB_VARIABLES.map(item => ({
    name: item,
    value: item,
  }))

  const handleSubVarKeyChange = useCallback((key: string) => {
    const newCondition = produce(condition, (draft) => {
      draft.key = key
    })
    onUpdateSubVariableCondition?.(caseId, conditionId, condition.id, newCondition)
  }, [caseId, condition, conditionId, onUpdateSubVariableCondition])

  const doRemoveCondition = useCallback(() => {
    if (isSubVariableKey)
      onRemoveSubVariableCondition?.(caseId, conditionId, condition.id)
    else
      onRemoveCondition?.(caseId, condition.id)
  }, [caseId, condition, conditionId, isSubVariableKey, onRemoveCondition, onRemoveSubVariableCondition])

  return (
    <div className='flex mb-1 last-of-type:mb-0'>
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
                      ? <div className='flex items-center'>
                        <div className='flex px-1.5 items-center h-6 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark shadow-xs text-text-accent'>
                          <Variable02 className='w-3.5 h-3.5 text-text-accent' />
                          <div className='ml-0.5 system-xs-medium'>{item?.name}</div>
                        </div>
                        <XMarkIcon className='ml-0.5 w-3.5 h-3.5 text-gray-400' onClick={() => handleSubVarKeyChange('')} />
                      </div>
                      : <div className='text-gray-300 system-xs-medium'>{t('common.placeholder.select')}</div>
                  )}
                />
              )
              : (
                <VariableTag
                  valueSelector={condition.variable_selector || []}
                  varType={condition.varType}
                />
              )}

          </div>
          <div className='mx-1 w-[1px] h-3 bg-divider-regular'></div>
          <ConditionOperator
            disabled={disabled}
            varType={condition.varType}
            value={condition.comparison_operator}
            onSelect={handleUpdateConditionOperator}
            file={file}
          />
        </div>
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && !isNotInput && condition.varType !== VarType.number && (
            <div className='px-2 py-1 max-h-[100px] border-t border-t-divider-subtle overflow-y-auto'>
              <ConditionInput
                disabled={disabled}
                value={condition.value}
                onChange={handleUpdateConditionValue}
                nodesOutputVars={nodesOutputVars}
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
                value={condition.value}
                onValueChange={handleUpdateConditionValue}
                variables={numberVariables}
              />
            </div>
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && isSelect && (
            <div className='p-1'>
              <Select
                wrapperClassName='h-6'
                className='pl-0 text-xs'
                defaultValue={condition.value}
                items={selectOptions}
                onSelect={item => handleUpdateConditionValue(item.value as string)}
              />
            </div>
          )
        }
        {
          !comparisonOperatorNotRequireValue(condition.comparison_operator) && isSubVariable && (
            <div className='p-1'>
              <ConditionWrap
                isSubVariable
                caseId={caseId}
                conditionId={conditionId}
                readOnly={!!disabled}
                cases={condition.sub_variable_condition ? [condition.sub_variable_condition] : []}
                handleAddSubVariableCondition={onAddSubVariableCondition}
                handleRemoveSubVariableCondition={onRemoveSubVariableCondition}
                handleUpdateSubVariableCondition={onUpdateSubVariableCondition}
                handleToggleSubVariableConditionLogicalOperator={onToggleSubVariableConditionLogicalOperator}
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
