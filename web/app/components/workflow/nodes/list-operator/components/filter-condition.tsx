'use client'
import type { FC } from 'react'
import type { Condition } from '../types'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect as Select } from '@/app/components/base/select'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '@/app/components/workflow/nodes/constants'
import { getConditionValueAsString } from '@/app/components/workflow/nodes/utils'
import { cn } from '@/utils/classnames'
import BoolValue from '../../../panel/chat-variable-panel/components/bool-value'
import { VarType } from '../../../types'
import ConditionOperator from '../../if-else/components/condition-list/condition-operator'
import { ComparisonOperator } from '../../if-else/types'
import { comparisonOperatorNotRequireValue, getOperators } from '../../if-else/utils'
import SubVariablePicker from './sub-variable-picker'

const optionNameI18NPrefix = 'nodes.ifElse.optionName'

const VAR_INPUT_SUPPORTED_KEYS: Record<string, VarType> = {
  name: VarType.string,
  url: VarType.string,
  extension: VarType.string,
  mime_type: VarType.string,
  related_id: VarType.string,
  size: VarType.number,
}

type Props = {
  condition: Condition
  varType: VarType
  onChange: (condition: Condition) => void
  hasSubVariable: boolean
  readOnly: boolean
  nodeId: string
}

const FilterCondition: FC<Props> = ({
  condition = { key: '', comparison_operator: ComparisonOperator.equal, value: '' },
  varType,
  onChange,
  hasSubVariable,
  readOnly,
  nodeId,
}) => {
  const { t } = useTranslation()
  const [isFocus, setIsFocus] = useState(false)

  const expectedVarType = condition.key ? VAR_INPUT_SUPPORTED_KEYS[condition.key] : varType
  const supportVariableInput = !!expectedVarType

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload) => {
      return expectedVarType ? varPayload.type === expectedVarType : true
    },
  })

  const isSelect = [ComparisonOperator.in, ComparisonOperator.notIn, ComparisonOperator.allOf].includes(condition.comparison_operator)
  const isArrayValue = condition.key === 'transfer_method' || condition.key === 'type'
  const isBoolean = varType === VarType.boolean

  const selectOptions = useMemo(() => {
    if (isSelect) {
      if (condition.key === 'type' || condition.comparison_operator === ComparisonOperator.allOf) {
        return FILE_TYPE_OPTIONS.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`, { ns: 'workflow' }),
          value: item.value,
        }))
      }
      if (condition.key === 'transfer_method') {
        return TRANSFER_METHOD.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`, { ns: 'workflow' }),
          value: item.value,
        }))
      }
      return []
    }
    return []
  }, [condition.comparison_operator, condition.key, isSelect, t])

  const handleChange = useCallback((key: string) => {
    return (value: any) => {
      onChange({
        ...condition,
        [key]: (isArrayValue && key === 'value') ? [value] : value,
      })
    }
  }, [condition, onChange, isArrayValue])

  const handleSubVariableChange = useCallback((value: string) => {
    const operators = getOperators(expectedVarType ?? VarType.string, { key: value })
    const newOperator = operators.length > 0 ? operators[0] : ComparisonOperator.equal
    onChange({
      key: value,
      comparison_operator: newOperator,
      value: '',
    })
  }, [onChange, expectedVarType])

  // Extract input rendering logic to avoid nested ternary
  let inputElement: React.ReactNode = null
  if (!comparisonOperatorNotRequireValue(condition.comparison_operator)) {
    if (isSelect) {
      inputElement = (
        <Select
          items={selectOptions}
          defaultValue={isArrayValue ? (condition.value as string[])[0] : condition.value as string}
          onSelect={item => handleChange('value')(item.value)}
          className="!text-[13px]"
          wrapperClassName="grow h-8"
          placeholder="Select value"
        />
      )
    }
    else if (isBoolean) {
      inputElement = (
        <BoolValue
          value={condition.value as boolean}
          onChange={handleChange('value')}
        />
      )
    }
    else if (supportVariableInput) {
      inputElement = (
        <Input
          instanceId="filter-condition-input"
          className={cn(
            isFocus
              ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs'
              : 'border-components-input-border-hover bg-components-input-bg-normal',
            'w-0 grow rounded-lg border px-3 py-[6px]',
          )}
          value={
            getConditionValueAsString(condition)
          }
          onChange={handleChange('value')}
          readOnly={readOnly}
          nodesOutputVars={availableVars}
          availableNodes={availableNodesWithParent}
          onFocusChange={setIsFocus}
          placeholder={!readOnly ? t('nodes.http.insertVarPlaceholder', { ns: 'workflow' })! : ''}
          placeholderClassName="!leading-[21px]"
        />
      )
    }
    else {
      inputElement = (
        <input
          type={((hasSubVariable && condition.key === 'size') || (!hasSubVariable && varType === VarType.number)) ? 'number' : 'text'}
          className="grow rounded-lg border border-components-input-border-hover bg-components-input-bg-normal px-3 py-[6px]"
          value={
            getConditionValueAsString(condition)
          }
          onChange={e => handleChange('value')(e.target.value)}
          readOnly={readOnly}
        />
      )
    }
  }

  return (
    <div>
      {hasSubVariable && (
        <SubVariablePicker
          className="mb-2"
          value={condition.key}
          onChange={handleSubVariableChange}
        />
      )}
      <div className="flex space-x-1">
        <ConditionOperator
          className="h-8 bg-components-input-bg-normal"
          varType={expectedVarType ?? varType ?? VarType.string}
          value={condition.comparison_operator}
          onSelect={handleChange('comparison_operator')}
          file={hasSubVariable ? { key: condition.key } : undefined}
          disabled={readOnly}
        />
        {inputElement}
      </div>
    </div>
  )
}

export default React.memo(FilterCondition)
