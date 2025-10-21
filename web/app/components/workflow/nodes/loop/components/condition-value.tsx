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
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

type ConditionValueProps = {
  variableSelector: string[]
  labelName?: string
  operator: ComparisonOperator
  value: string | string[]
}
const ConditionValue = ({
  variableSelector,
  labelName: _labelName,
  operator,
  value,
}: ConditionValueProps) => {
  const { t } = useTranslation()
  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`workflow.nodes.ifElse.comparisonOperator.${operator}`) : operator
  const notHasValue = comparisonOperatorNotRequireValue(operator)
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
    <div className='flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1'>
      <VariableLabelInNode
        className='w-0 grow'
        variables={variableSelector}
        notShowFullPath
      />
      <div
        className='mx-1 shrink-0 text-xs font-medium text-text-primary'
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
