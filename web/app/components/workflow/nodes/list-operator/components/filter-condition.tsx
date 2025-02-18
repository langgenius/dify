'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ConditionOperator from '../../if-else/components/condition-list/condition-operator'
import { VarType } from '../../../types'
import type { Condition } from '../types'
import { ComparisonOperator } from '../../if-else/types'
import { comparisonOperatorNotRequireValue, getOperators } from '../../if-else/utils'
import SubVariablePicker from './sub-variable-picker'
import Input from '@/app/components/base/input'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '@/app/components/workflow/nodes/constants'
import { SimpleSelect as Select } from '@/app/components/base/select'

const optionNameI18NPrefix = 'workflow.nodes.ifElse.optionName'
type Props = {
  condition: Condition
  onChange: (condition: Condition) => void
  varType: VarType
  hasSubVariable: boolean
  readOnly: boolean
}

const FilterCondition: FC<Props> = ({
  condition = { key: '', comparison_operator: ComparisonOperator.equal, value: '' },
  varType,
  onChange,
  hasSubVariable,
  readOnly,
}) => {
  const { t } = useTranslation()
  const isSelect = [ComparisonOperator.in, ComparisonOperator.notIn, ComparisonOperator.allOf].includes(condition.comparison_operator)
  const isArrayValue = condition.key === 'transfer_method' || condition.key === 'type'
  const selectOptions = useMemo(() => {
    if (isSelect) {
      if (condition.key === 'type' || condition.comparison_operator === ComparisonOperator.allOf) {
        return FILE_TYPE_OPTIONS.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`),
          value: item.value,
        }))
      }
      if (condition.key === 'transfer_method') {
        return TRANSFER_METHOD.map(item => ({
          name: t(`${optionNameI18NPrefix}.${item.i18nKey}`),
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
    onChange({
      key: value,
      comparison_operator: getOperators(varType, { key: value })[0],
      value: '',
    })
  }, [onChange, varType])

  return (
    <div>
      {hasSubVariable && (
        <SubVariablePicker
          className="mb-2"
          value={condition.key}
          onChange={handleSubVariableChange}
        />
      )}
      <div className='flex space-x-1'>
        <ConditionOperator
          className='bg-components-input-bg-normal h-8'
          varType={varType}
          value={condition.comparison_operator}
          onSelect={handleChange('comparison_operator')}
          file={hasSubVariable ? { key: condition.key } : undefined}
          disabled={readOnly}
        />
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) && (
          <>
            {isSelect && (
              <Select
                items={selectOptions}
                defaultValue={isArrayValue ? (condition.value as string[])[0] : condition.value as string}
                onSelect={item => handleChange('value')(item.value)}
                className='!text-[13px]'
                wrapperClassName='grow h-8'
                placeholder='Select value'
              />
            )}
            {!isSelect && (
              <Input
                type={((hasSubVariable && condition.key === 'size') || (!hasSubVariable && varType === VarType.number)) ? 'number' : 'text'}
                className='grow'
                value={condition.value}
                onChange={e => handleChange('value')(e.target.value)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(FilterCondition)
