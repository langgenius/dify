import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ComparisonOperator } from '../types'
import {
  comparisonOperatorNotRequireValue,
  isComparisonOperatorNeedTranslate,
} from '../utils'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from './../default'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import cn from '@/utils/classnames'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'

type ConditionValueProps = {
  variableSelector: string[]
  labelName?: string
  operator: ComparisonOperator
  value: string | string[]
}
const ConditionValue = ({
  variableSelector,
  labelName,
  operator,
  value,
}: ConditionValueProps) => {
  const { t } = useTranslation()
  const variableName = labelName || (isSystemVar(variableSelector) ? variableSelector.slice(0).join('.') : variableSelector.slice(1).join('.'))
  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`workflow.nodes.ifElse.comparisonOperator.${operator}`) : operator
  const notHasValue = comparisonOperatorNotRequireValue(operator)
  const isEnvVar = isENV(variableSelector)
  const isChatVar = isConversationVar(variableSelector)
  const formatValue = useMemo(() => {
    if (notHasValue)
      return ''

    if (Array.isArray(value)) // transfer method
      return value[0]

    return value.replace(/{{#([^#]*)#}}/g, (a, b) => {
      const arr: string[] = b.split('.')
      if (isSystemVar(arr))
        return `{{${b}}}`

      return `{{${arr.slice(1).join('.')}}}`
    })
  }, [notHasValue, value])

  const isSelect = operator === ComparisonOperator.in || operator === ComparisonOperator.notIn
  const selectName = useMemo(() => {
    if (isSelect) {
      const name = [...FILE_TYPE_OPTIONS, ...TRANSFER_METHOD].filter(item => item.value === (Array.isArray(value) ? value[0] : value))[0]
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
  }, [isSelect, t, value])

  return (
    <div className='flex items-center px-1 h-6 rounded-md bg-workflow-block-parma-bg'>
      {!isEnvVar && !isChatVar && <Variable02 className='shrink-0 mr-1 w-3.5 h-3.5 text-text-accent' />}
      {isEnvVar && <Env className='shrink-0 mr-1 w-3.5 h-3.5 text-util-colors-violet-violet-600' />}
      {isChatVar && <BubbleX className='w-3.5 h-3.5 text-util-colors-teal-teal-700' />}

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
        className='shrink-0 mx-1 text-xs font-medium text-text-primary'
        title={operatorName}
      >
        {operatorName}
      </div>
      {
        !notHasValue && (
          <div className='truncate text-xs text-text-secondary' title={formatValue}>{isSelect ? selectName : formatValue}</div>
        )
      }
    </div>
  )
}

export default memo(ConditionValue)
