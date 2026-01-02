import type {
  CommonNodeType,
  Node,
} from '@/app/components/workflow/types'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  VariableLabelInText,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import { FILE_TYPE_OPTIONS, TRANSFER_METHOD } from '../../constants'
import { ComparisonOperator } from '../types'
import {
  comparisonOperatorNotRequireValue,
  isComparisonOperatorNeedTranslate,
} from '../utils'

type ConditionValueProps = {
  variableSelector: string[]
  labelName?: string
  operator: ComparisonOperator
  value: string | string[] | boolean
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
  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`nodes.ifElse.comparisonOperator.${operator}`, { ns: 'workflow' }) : operator
  const notHasValue = comparisonOperatorNotRequireValue(operator)
  const node: Node<CommonNodeType> | undefined = nodes.find(n => n.id === variableSelector[0]) as Node<CommonNodeType>
  const isException = isExceptionVariable(variableName, node?.data.type)
  const formatValue = useMemo(() => {
    if (notHasValue)
      return ''

    if (Array.isArray(value)) // transfer method
      return value[0]

    if (value === true || value === false)
      return value ? 'True' : 'False'

    return value.replace(/\{\{#([^#]*)#\}\}/g, (a, b) => {
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
        ? t(`nodes.ifElse.optionName.${name.i18nKey}`, { ns: 'workflow' }).replace(/\{\{#([^#]*)#\}\}/g, (a, b) => {
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
    <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1">
      <VariableLabelInText
        className="w-0 grow"
        variables={variableSelector}
        nodeTitle={node?.data.title}
        nodeType={node?.data.type}
        isExceptionVariable={isException}
        notShowFullPath
      />
      <div
        className="mx-1 shrink-0 text-xs font-medium text-text-primary"
        title={operatorName}
      >
        {operatorName}
      </div>
      {
        !notHasValue && (
          <div className="shrink-[3] truncate text-xs text-text-secondary" title={formatValue}>{isSelect ? selectName : formatValue}</div>
        )
      }
    </div>
  )
}

export default memo(ConditionValue)
