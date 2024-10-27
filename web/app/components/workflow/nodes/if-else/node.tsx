import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import { NodeSourceHandle } from '../_base/components/node-handle'
import { isEmptyRelatedOperator } from './utils'
import type { IfElseNodeType } from './types'
import ConditionValue from './components/condition-value'
const i18nPrefix = 'workflow.nodes.ifElse'

const IfElseNode: FC<NodeProps<IfElseNodeType>> = (props) => {
  const { data } = props
  const { t } = useTranslation()
  const { cases } = data
  const casesLength = cases.length

  return (
    <div className='px-3'>
      {
        cases.map((caseItem, index) => (
          <div key={caseItem.case_id}>
            <div className='relative flex items-center h-6 px-1'>
              <div className='flex items-center justify-between w-full'>
                <div className='text-[10px] font-semibold text-text-tertiary'>
                  {casesLength > 1 && `CASE ${index + 1}`}
                </div>
                <div className='text-[12px] font-semibold text-text-secondary'>{index === 0 ? 'IF' : 'ELIF'}</div>
              </div>
              <NodeSourceHandle
                {...props}
                handleId={caseItem.case_id}
                handleClassName='!top-1/2 !-right-[21px] !-translate-y-1/2'
              />
            </div>
            <div className='space-y-0.5'>
              {caseItem.conditions.map((condition, i) => (
                <div key={condition.id} className='relative'>
                  {(condition.variable_selector?.length > 0 && condition.comparison_operator && (isEmptyRelatedOperator(condition.comparison_operator!) ? true : !!condition.value))
                    ? (
                      <ConditionValue
                        variableSelector={condition.variable_selector}
                        operator={condition.comparison_operator}
                        value={condition.value}
                      />
                    )
                    : (
                      <div className='flex items-center h-6 px-1 space-x-1 text-xs font-normal text-text-secondary bg-workflow-block-parma-bg rounded-md'>
                        {t(`${i18nPrefix}.conditionNotSetup`)}
                      </div>
                    )}
                  {i !== caseItem.conditions.length - 1 && (
                    <div className='absolute z-10 right-0 bottom-[-10px] leading-4 text-[10px] font-medium text-text-accent uppercase'>{t(`${i18nPrefix}.${caseItem.logical_operator}`)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      }
      <div className='relative flex items-center h-6 px-1'>
        <div className='w-full text-xs font-semibold text-right text-text-secondary'>ELSE</div>
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
