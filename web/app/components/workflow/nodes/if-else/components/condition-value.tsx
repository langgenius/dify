import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComparisonOperator } from '../types'
import {
  comparisonOperatorNotRequireValue,
  isComparisonOperatorNeedTranslate,
} from '../utils'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import cn from '@/utils/classnames'

type ConditionValueProps = {
  variable: string
  operator: ComparisonOperator
  value: string
}
const ConditionValue = ({
  variable,
  operator,
  value,
}: ConditionValueProps) => {
  const { t } = useTranslation()
  const operatorName = isComparisonOperatorNeedTranslate(operator) ? t(`workflow.nodes.ifElse.comparisonOperator.${operator}`) : operator
  const notHasValue = comparisonOperatorNotRequireValue(operator)

  return (
    <div className='flex items-center px-1 h-6 rounded-md bg-workflow-block-parma-bg'>
      <Variable02 className='shrink-0 mr-1 w-3.5 h-3.5 text-text-accent' />
      <div
        className={cn(
          'shrink-0  truncate text-xs font-medium text-text-accent',
          !notHasValue && 'max-w-[70px]',
        )}
        title={variable}
      >
        {variable}
      </div>
      <div
        className='shrink-0 mx-1 text-xs font-medium text-text-primary'
        title={operatorName}
      >
        {operatorName}
      </div>
      {
        !notHasValue && (
          <div className='truncate text-xs text-text-secondary'>{value.replace(/{{#[^#]*?\.(\w+)#}}/g, '{{$1}}')}</div>
        )
      }
    </div>
  )
}

export default memo(ConditionValue)
