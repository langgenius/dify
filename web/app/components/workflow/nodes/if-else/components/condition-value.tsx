import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { ComparisonOperator } from '../types'
import {
  comparisonOperatorNotRequireValue,
  isComparisonOperatorNeedTranslate,
} from '../utils'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '../../constants'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import cn from '@/utils/classnames'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'

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
  const nodes = useNodes()
  const variableName = labelName || (isSystemVar(variableSelector) ? variableSelector.slice(0).join('.') : variableSelector.slice(1).join('.'))
  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`workflow.nodes.ifElse.comparisonOperator.${operator}`) : operator
  const notHasValue = comparisonOperatorNotRequireValue(operator)
  const isEnvVar = isENV(variableSelector)
  const isChatVar = isConversationVar(variableSelector)
  const node: Node<CommonNodeType> | undefined = nodes.find(n => n.id === variableSelector[0]) as Node<CommonNodeType>
  const isException = isExceptionVariable(variableName, node?.data.type)
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
    <div className='bg-workflow-block-parma-bg flex h-6 items-center rounded-md px-1'>
      {!isEnvVar && !isChatVar && <Variable02 className={cn('text-text-accent mr-1 h-3.5 w-3.5 shrink-0', isException && 'text-text-warning')} />}
      {isEnvVar && <Env className='text-util-colors-violet-violet-600 mr-1 h-3.5 w-3.5 shrink-0' />}
      {isChatVar && <BubbleX className='text-util-colors-teal-teal-700 h-3.5 w-3.5' />}

      <div
        className={cn(
          'text-text-accent ml-0.5 shrink-0 truncate text-xs font-medium',
          !notHasValue && 'max-w-[70px]',
          isException && 'text-text-warning',
        )}
        title={variableName}
      >
        {variableName}
      </div>
      <div
        className='text-text-primary mx-1 shrink-0 text-xs font-medium'
        title={operatorName}
      >
        {operatorName}
      </div>
      {
        !notHasValue && (
          <div className='text-text-secondary truncate text-xs' title={formatValue}>{isSelect ? selectName : formatValue}</div>
        )
      }
    </div>
  )
}

export default memo(ConditionValue)
