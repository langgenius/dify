import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ComparisonOperator, type Condition } from '../types'
import {
  comparisonOperatorNotRequireValue,
  isComparisonOperatorNeedTranslate,
  isEmptyRelatedOperator,
} from '../utils'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '../../constants'
import type { ValueSelector } from '../../../types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import cn from '@/utils/classnames'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
const i18nPrefix = 'workflow.nodes.ifElse'

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

  const variableName = (isSystemVar(variableSelector) ? variableSelector.slice(0).join('.') : variableSelector.slice(1).join('.'))
  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`workflow.nodes.ifElse.comparisonOperator.${operator}`) : operator
  const notHasValue = comparisonOperatorNotRequireValue(operator)
  const isEnvVar = isENV(variableSelector)
  const isChatVar = isConversationVar(variableSelector)
  const formatValue = useCallback((c: Condition) => {
    const notHasValue = comparisonOperatorNotRequireValue(c.comparison_operator)
    if (notHasValue)
      return ''

    const value = c.value as string
    return value.replace(/{{#([^#]*)#}}/g, (a, b) => {
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
        ? t(`workflow.nodes.ifElse.optionName.${name.i18nKey}`).replace(/{{#([^#]*)#}}/g, (a, b) => {
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
    <div className='rounded-md bg-workflow-block-parma-bg'>
      <div className='flex h-6 items-center px-1 '>
        {!isEnvVar && !isChatVar && <Variable02 className='mr-1 h-3.5 w-3.5 shrink-0 text-text-accent' />}
        {isEnvVar && <Env className='mr-1 h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600' />}
        {isChatVar && <BubbleX className='h-3.5 w-3.5 text-util-colors-teal-teal-700' />}

        <div
          className={cn(
            'shrink-0  truncate text-xs font-medium text-text-accent',
            !notHasValue && 'max-w-[70px]',
          )}
          title={variableName}
        >
          {variableName}
        </div>
        <div
          className='mx-1 shrink-0 text-xs font-medium text-text-primary'
          title={operatorName}
        >
          {operatorName}
        </div>
      </div>
      <div className='ml-[10px] border-l border-divider-regular pl-[10px]'>
        {
          sub_variable_condition?.conditions.map((c: Condition, index) => (
            <div className='relative flex h-6 items-center space-x-1' key={c.id}>
              <div className='system-xs-medium text-text-accent'>{c.key}</div>
              <div className='system-xs-medium text-text-primary'>{isComparisonOperatorNeedTranslate(c.comparison_operator) ? t(`workflow.nodes.ifElse.comparisonOperator.${c.comparison_operator}`) : c.comparison_operator}</div>
              {c.comparison_operator && !isEmptyRelatedOperator(c.comparison_operator) && <div className='system-xs-regular text-text-secondary'>{isSelect(c) ? selectName(c) : formatValue(c)}</div>}
              {index !== sub_variable_condition.conditions.length - 1 && (<div className='absolute bottom-[-10px] right-1 z-10 text-[10px] font-medium uppercase leading-4 text-text-accent'>{t(`${i18nPrefix}.${sub_variable_condition.logical_operator}`)}</div>)}
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default memo(ConditionValue)
