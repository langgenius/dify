import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import { NodeSourceHandle } from '../_base/components/node-handle'
import { isComparisonOperatorNeedTranslate, isEmptyRelatedOperator } from './utils'
import type { IfElseNodeType } from './types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
const i18nPrefix = 'workflow.nodes.ifElse'

const IfElseNode: FC<NodeProps<IfElseNodeType>> = (props) => {
  const { data } = props
  const { t } = useTranslation()
  const { conditions, logical_operator } = data

  return (
    <div className='px-3'>
      <div className='relative flex items-center h-6 px-1'>
        <div className='w-full text-xs font-semibold text-right text-gray-700'>IF</div>
        <NodeSourceHandle
          {...props}
          handleId='true'
          handleClassName='!top-1/2 !-right-[21px] !-translate-y-1/2'
        />
      </div>
      <div className='space-y-0.5'>
        {conditions.map((condition, i) => (
          <div key={condition.id} className='relative'>
            {(condition.variable_selector?.length > 0 && condition.comparison_operator && (isEmptyRelatedOperator(condition.comparison_operator!) ? true : !!condition.value))
              ? (
                <div className='flex items-center h-6 px-1 space-x-1 text-xs font-normal text-gray-700 bg-gray-100 rounded-md'>
                  <Variable02 className='w-3.5 h-3.5 text-primary-500' />
                  <span>{condition.variable_selector.slice(-1)[0]}</span>
                  <span className='text-gray-500'>{isComparisonOperatorNeedTranslate(condition.comparison_operator) ? t(`${i18nPrefix}.comparisonOperator.${condition.comparison_operator}`) : condition.comparison_operator}</span>
                  {!isEmptyRelatedOperator(condition.comparison_operator!) && <span>{condition.value}</span>}
                </div>
              )
              : (
                <div className='flex items-center h-6 px-1 space-x-1 text-xs font-normal text-gray-500 bg-gray-100 rounded-md'>
                  {t(`${i18nPrefix}.conditionNotSetup`)}
                </div>
              )}
            {i !== conditions.length - 1 && (
              <div className='absolute z-10 right-0 bottom-[-10px] leading-4 text-[10px] font-medium text-primary-600 uppercase'>{t(`${i18nPrefix}.${logical_operator}`)}</div>
            )}
          </div>
        ))}
      </div>
      <div className='relative flex items-center h-6 px-1'>
        <div className='w-full text-xs font-semibold text-right text-gray-700'>ELSE</div>
        <NodeSourceHandle
          {...props}
          handleId='false'
          handleClassName='!top-1/2 !-right-[21px] !-translate-y-1/2'
        />
      </div>
    </div>
  )
}

export default React.memo(IfElseNode)
