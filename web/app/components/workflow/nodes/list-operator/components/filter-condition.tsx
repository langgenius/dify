'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ConditionOperator from '../../if-else/components/condition-list/condition-operator'
import type { Condition } from '../types'
import { ComparisonOperator } from '../../if-else/types'
import { comparisonOperatorNotRequireValue, getOperators } from '../../if-else/utils'
import SubVariablePicker from './sub-variable-picker'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '@/app/components/workflow/nodes/constants'
import { SimpleSelect as Select } from '@/app/components/base/select'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import cn from '@/utils/classnames'
import { VarType } from '../../../types'

const optionNameI18NPrefix = 'workflow.nodes.ifElse.optionName'

const VAR_INPUT_SUPPORTED_KEYS: Record<string, VarType> = {
  name: VarType.string,
  url: VarType.string,
  extension: VarType.string,
  mime_type: VarType.string,
  related_id: VarType.number,
}

type Props = {
  condition: Condition
  onChange: (condition: Condition) => void
  hasSubVariable: boolean
  readOnly: boolean
  nodeId: string
}

const FilterCondition: FC<Props> = ({
  condition = { key: '', comparison_operator: ComparisonOperator.equal, value: '' },
  onChange,
  hasSubVariable,
  readOnly,
  nodeId,
}) => {
  const { t } = useTranslation()
  const [isFocus, setIsFocus] = useState(false)

  const expectedVarType = VAR_INPUT_SUPPORTED_KEYS[condition.key]
  const supportVariableInput = !!expectedVarType

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload) => {
      return expectedVarType ? varPayload.type === expectedVarType : true
    },
  })

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
      <div className='flex space-x-1'>
        <ConditionOperator
          className='h-8 bg-components-input-bg-normal'
          varType={expectedVarType ?? VarType.string}
          value={condition.comparison_operator}
          onSelect={handleChange('comparison_operator')}
          file={hasSubVariable ? { key: condition.key } : undefined}
          disabled={readOnly}
        />
        {!comparisonOperatorNotRequireValue(condition.comparison_operator) && (
          <>
            {isSelect ? (
              <Select
                items={selectOptions}
                defaultValue={isArrayValue ? (condition.value as string[])[0] : condition.value as string}
                onSelect={item => handleChange('value')(item.value)}
                className='!text-[13px]'
                wrapperClassName='grow h-8'
                placeholder='Select value'
              />
            ) : supportVariableInput ? (
              <Input
                instanceId='filter-condition-input'
                className={cn(
                  isFocus
                    ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs'
                    : 'border-components-input-border-hover bg-components-input-bg-normal',
                  'w-0 grow rounded-lg border px-3 py-[6px]',
                )}
                value={condition.value}
                onChange={handleChange('value')}
                readOnly={readOnly}
                nodesOutputVars={availableVars}
                availableNodes={availableNodesWithParent}
                onFocusChange={setIsFocus}
                placeholder={!readOnly ? t('workflow.nodes.http.extractListPlaceholder')! : ''}
                placeholderClassName='!leading-[21px]'
              />
            ) : (
              <input
                type={(condition.key === 'size' || expectedVarType === VarType.number) ? 'number' : 'text'}
                className='grow rounded-lg border border-components-input-border-hover bg-components-input-bg-normal px-3 py-[6px]'
                value={condition.value}
                onChange={e => handleChange('value')(e.target.value)}
                readOnly={readOnly}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default React.memo(FilterCondition)
