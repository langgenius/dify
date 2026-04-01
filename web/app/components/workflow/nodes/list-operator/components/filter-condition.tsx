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

type VariableInputProps = React.ComponentProps<typeof Input>

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

const getExpectedVarType = (condition: Condition, varType: VarType) => {
  return condition.key ? VAR_INPUT_SUPPORTED_KEYS[condition.key] : varType
}

const getSelectOptions = (
  condition: Condition,
  isSelect: boolean,
  t: ReturnType<typeof useTranslation>['t'],
) => {
  if (!isSelect)
    return []

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

const getFallbackInputType = ({
  hasSubVariable,
  condition,
  varType,
}: {
  hasSubVariable: boolean
  condition: Condition
  varType: VarType
}) => {
  return ((hasSubVariable && condition.key === 'size') || (!hasSubVariable && varType === VarType.number))
    ? 'number'
    : 'text'
}

const ValueInput = ({
  comparisonOperator,
  isSelect,
  isArrayValue,
  isBoolean,
  supportVariableInput,
  selectOptions,
  condition,
  readOnly,
  availableVars,
  availableNodesWithParent,
  onFocusChange,
  onChange,
  hasSubVariable,
  varType,
  t,
}: {
  comparisonOperator: ComparisonOperator
  isSelect: boolean
  isArrayValue: boolean
  isBoolean: boolean
  supportVariableInput: boolean
  selectOptions: Array<{ name: string, value: string }>
  condition: Condition
  readOnly: boolean
  availableVars: VariableInputProps['nodesOutputVars']
  availableNodesWithParent: VariableInputProps['availableNodes']
  onFocusChange: (value: boolean) => void
  onChange: (value: unknown) => void
  hasSubVariable: boolean
  varType: VarType
  t: ReturnType<typeof useTranslation>['t']
}) => {
  const [isFocus, setIsFocus] = useState(false)

  const handleFocusChange = (value: boolean) => {
    setIsFocus(value)
    onFocusChange(value)
  }

  if (comparisonOperatorNotRequireValue(comparisonOperator))
    return null

  if (isSelect) {
    return (
      <Select
        items={selectOptions}
        defaultValue={isArrayValue ? (condition.value as string[])[0] : condition.value as string}
        onSelect={item => onChange(item.value)}
        className="!text-[13px]"
        wrapperClassName="grow h-8"
        placeholder="Select value"
      />
    )
  }

  if (isBoolean) {
    return (
      <BoolValue
        value={condition.value as boolean}
        onChange={onChange}
      />
    )
  }

  if (supportVariableInput) {
    return (
      <Input
        instanceId="filter-condition-input"
        className={cn(
          isFocus
            ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs'
            : 'border-components-input-border-hover bg-components-input-bg-normal',
          'w-0 grow rounded-lg border px-3 py-[6px]',
        )}
        value={getConditionValueAsString(condition)}
        onChange={onChange}
        readOnly={readOnly}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onFocusChange={handleFocusChange}
        placeholder={!readOnly ? t('nodes.http.insertVarPlaceholder', { ns: 'workflow' })! : ''}
        placeholderClassName="!leading-[21px]"
      />
    )
  }

  return (
    <input
      type={getFallbackInputType({ hasSubVariable, condition, varType })}
      className="grow rounded-lg border border-components-input-border-hover bg-components-input-bg-normal px-3 py-[6px]"
      value={getConditionValueAsString(condition)}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
    />
  )
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

  const expectedVarType = getExpectedVarType(condition, varType)
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

  const selectOptions = useMemo(() => getSelectOptions(condition, isSelect, t), [condition, isSelect, t])

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
        <ValueInput
          comparisonOperator={condition.comparison_operator}
          isSelect={isSelect}
          isArrayValue={isArrayValue}
          isBoolean={isBoolean}
          supportVariableInput={supportVariableInput}
          selectOptions={selectOptions}
          condition={condition}
          readOnly={readOnly}
          availableVars={availableVars}
          availableNodesWithParent={availableNodesWithParent}
          onFocusChange={(_value) => {}}
          onChange={handleChange('value')}
          hasSubVariable={hasSubVariable}
          varType={varType}
          t={t}
        />
      </div>
    </div>
  )
}

export default React.memo(FilterCondition)
