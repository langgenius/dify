import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import { NodeSourceHandle } from '../_base/components/node-handle'
import ReadonlyInputWithSelectVar from '../_base/components/readonly-input-with-select-var'
import { isComparisonOperatorNeedTranslate, isEmptyRelatedOperator } from './utils'
import type { IfElseNodeType } from './types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
const i18nPrefix = 'workflow.nodes.ifElse'

const IfElseNode: FC<NodeProps<IfElseNodeType>> = (props) => {
  const { data, id } = props
  const { t } = useTranslation()
  const { cases } = data
  const casesLength = cases.length

  return (
    <div className='px-3'>
      {
        cases.map((caseItem, index) => (
          <div key={caseItem.caseId}>
            <div className='relative flex items-center h-6 px-1'>
              <div className='flex items-center justify-between w-full'>
                <div className='text-[10px] font-semibold text-[#676F83]'>
                  {casesLength > 1 && `CASE ${index + 1}`}
                </div>
                <div className='text-[12px] font-semibold text-[#354052]'>{index === 0 ? 'IF' : 'ELIF'}</div>
              </div>
              <NodeSourceHandle
                {...props}
                handleId={caseItem.caseId}
                handleClassName='!top-1/2 !-right-[21px] !-translate-y-1/2'
              />
            </div>
            <div className='space-y-0.5'>
              {caseItem.conditions.map((condition, i) => (
                <div key={condition.id} className='relative'>
                  {(condition.variable_selector?.length > 0 && condition.comparison_operator && (isEmptyRelatedOperator(condition.comparison_operator!) ? true : !!condition.value))
                    ? (
                      <div className='flex items-center px-[5px] h-6 rounded-md bg-[#F2F4F7]'>
                        <Variable02 className='shrink-0 mr-1 w-3.5 h-3.5 text-primary-500' />
                        <span className='shrink-0 text-xs font-medium text-primary-500'>{condition.variable_selector.slice(-1)[0]}</span>
                        <span className='shrink-0 mx-1 text-xs font-medium text-[#101828]'>{isComparisonOperatorNeedTranslate(condition.comparison_operator) ? t(`${i18nPrefix}.comparisonOperator.${condition.comparison_operator}`) : condition.comparison_operator}</span>
                        {
                          !isEmptyRelatedOperator(condition.comparison_operator!) && (
                            <ReadonlyInputWithSelectVar
                              nodeId={id}
                              value={condition.value}
                              className='grow pt-[3px] h-4 !leading-4 overflow-hidden'
                            />
                          )
                        }
                      </div>
                    )
                    : (
                      <div className='flex items-center h-6 px-1 space-x-1 text-xs font-normal text-gray-500 bg-gray-100 rounded-md'>
                        {t(`${i18nPrefix}.conditionNotSetup`)}
                      </div>
                    )}
                  {i !== caseItem.conditions.length - 1 && (
                    <div className='absolute z-10 right-0 bottom-[-10px] leading-4 text-[10px] font-medium text-primary-600 uppercase'>{t(`${i18nPrefix}.${caseItem.logical_operator}`)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      }
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
