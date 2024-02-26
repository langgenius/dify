import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import { NodeSourceHandle } from '../_base/components/node-handle'
import { mockData } from './mock'
import { ComparisonOperator } from './types'
import { isEmptyRelatedOperator } from './utils'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
const i18nPrefix = 'workflow.nodes.ifElse'

const notTranslateKey = [
  ComparisonOperator.equal, ComparisonOperator.notEqual,
  ComparisonOperator.largerThan, ComparisonOperator.largerThanOrEqual,
  ComparisonOperator.lessThan, ComparisonOperator.lessThanOrEqual,
]

const Node = (props: Pick<NodeProps, 'id' | 'data'>) => {
  const { t } = useTranslation()
  const { conditions, logical_operator } = mockData

  return (
    <div className='px-3'>
      <div className='flex items-center h-6 relative px-1'>
        <div className='w-full text-right text-gray-700 text-xs font-semibold'>IF</div>
        <NodeSourceHandle
          {...props}
          handleId='condition1'
          handleClassName='!top-1 !-right-5'
        />
      </div>
      <div className='mb-0.5 leading-4 text-[10px] font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.conditions`)}</div>
      <div className='space-y-0.5'>
        {conditions.map((condition, i) => (
          <div key={condition.id} className='relative'>
            <div className='flex items-center h-6 bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
              <Variable02 className='w-3.5 h-3.5 text-primary-500' />
              <span>{condition.variable_selector.slice(-1)[0]}</span>
              <span className='text-gray-500'>{notTranslateKey.includes(condition.comparison_operator) ? condition.comparison_operator : t(`${i18nPrefix}.comparisonOperator.${condition.comparison_operator}`)}</span>
              {!isEmptyRelatedOperator(condition.comparison_operator) && <span>{condition.value}</span>}
            </div>
            {i !== conditions.length - 1 && (
              <div className='absolute z-10 right-0 bottom-[-10px] leading-4 text-[10px] font-medium text-primary-600 uppercase'>{t(`${i18nPrefix}.${logical_operator}`)}</div>
            )}
          </div>
        ))}
      </div>
      <div className='flex items-center h-6 relative px-1'>
        <div className='w-full text-right text-gray-700 text-xs font-semibold'>ELSE</div>
        <NodeSourceHandle
          {...props}
          handleId='condition2'
          handleClassName='!top-1 !-right-5'
        />
      </div>
    </div>
  )
}

export default memo(Node)
