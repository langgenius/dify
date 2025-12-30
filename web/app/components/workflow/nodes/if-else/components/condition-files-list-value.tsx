import type { ValueSelector } from '../../../types'
import type { Condition } from '../types'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '../../constants'
import { ComparisonOperator } from '../types'
import {
  comparisonOperatorNotRequireValue,
  isComparisonOperatorNeedTranslate,
  isEmptyRelatedOperator,
} from '../utils'

type ConditionValueProps = {
  condition: Condition
}
const ConditionValue = ({
  condition,
}: ConditionValueProps) => {
  const { t } = useTranslation()
  const {
    variable_selector,
    comparison_operator: operator,
    sub_variable_condition,
  } = condition

  const variableSelector = variable_selector as ValueSelector

  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`nodes.ifElse.comparisonOperator.${operator}`, { ns: 'workflow' }) : operator
  const formatValue = useCallback((c: Condition) => {
    const notHasValue = comparisonOperatorNotRequireValue(c.comparison_operator)
    if (notHasValue)
      return ''

    const value = c.value as string
    return value.replace(/\{\{#([^#]*)#\}\}/g, (a, b) => {
      const arr: string[] = b.split('.')
      if (isSystemVar(arr))
        return `{{${b}}}`

      return `{{${arr.slice(1).join('.')}}}`
    })
  }, [])

  const isSelect = useCallback((c: Condition) => {
    return c.comparison_operator === ComparisonOperator.in || c.comparison_operator === ComparisonOperator.notIn
  }, [])

  const selectName = useCallback((c: Condition) => {
    const isSelect = c.comparison_operator === ComparisonOperator.in || c.comparison_operator === ComparisonOperator.notIn
    if (isSelect) {
      const name = [...FILE_TYPE_OPTIONS, ...TRANSFER_METHOD].filter(item => item.value === (Array.isArray(c.value) ? c.value[0] : c.value))[0]
      return name
        ? t(`nodes.ifElse.optionName.${name.i18nKey}`, { ns: 'workflow' }).replace(/\{\{#([^#]*)#\}\}/g, (a, b) => {
            const arr: string[] = b.split('.')
            if (isSystemVar(arr))
              return `{{${b}}}`

            return `{{${arr.slice(1).join('.')}}}`
          })
        : ''
    }
    return ''
  }, [t])

  return (
    <div className="rounded-md bg-workflow-block-parma-bg">
      <div className="flex h-6 items-center px-1 ">
        <VariableLabelInNode
          className="w-0 grow"
          variables={variableSelector}
          notShowFullPath
        />
        <div
          className="mx-1 shrink-0 text-xs font-medium text-text-primary"
          title={operatorName}
        >
          {operatorName}
        </div>
      </div>
      <div className="ml-[10px] border-l border-divider-regular pl-[10px]">
        {
          sub_variable_condition?.conditions.map((c: Condition, index) => {
            const comparisonOperator = c.comparison_operator
            const comparisonOperatorName = comparisonOperator && isComparisonOperatorNeedTranslate(comparisonOperator)
              ? t(`nodes.ifElse.comparisonOperator.${comparisonOperator}`, { ns: 'workflow' })
              : comparisonOperator
            return (
              <div className="relative flex h-6 items-center space-x-1" key={c.id}>
                <div className="system-xs-medium text-text-accent">{c.key}</div>
                <div className="system-xs-medium text-text-primary">{comparisonOperatorName}</div>
                {c.comparison_operator && !isEmptyRelatedOperator(c.comparison_operator) && <div className="system-xs-regular text-text-secondary">{isSelect(c) ? selectName(c) : formatValue(c)}</div>}
                {index !== sub_variable_condition.conditions.length - 1 && (<div className="absolute bottom-[-10px] right-1 z-10 text-[10px] font-medium uppercase leading-4 text-text-accent">{t(`nodes.ifElse.${sub_variable_condition.logical_operator}`, { ns: 'workflow' })}</div>)}
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

export default memo(ConditionValue)
