import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import { NodeSourceHandle } from '../../node-handle'
import { isEmptyRelatedOperator } from '@/app/components/workflow/nodes/if-else/utils'
import type { Condition, IfElseNodeType } from '@/app/components/workflow/nodes/if-else/types'
import ConditionValue from '@/app/components/workflow/nodes/if-else/components/condition-value'
import ConditionFilesListValue from '@/app/components/workflow/nodes/if-else/components/condition-files-list-value'
const i18nPrefix = 'workflow.nodes.ifElse'

const IfElseNode: FC<NodeProps<IfElseNodeType>> = (props) => {
  const { data } = props
  const { t } = useTranslation()
  const { cases } = data
  const casesLength = cases.length
  const checkIsConditionSet = useCallback((condition: Condition) => {
    if (!condition.variable_selector || condition.variable_selector.length === 0)
      return false

    if (condition.sub_variable_condition) {
      const isSet = condition.sub_variable_condition.conditions.every((c) => {
        if (!c.comparison_operator)
          return false

        if (isEmptyRelatedOperator(c.comparison_operator!))
          return true

        return !!c.value
      })
      return isSet
    }
    else {
      if (isEmptyRelatedOperator(condition.comparison_operator!))
        return true

      return !!condition.value
    }
  }, [])
  const conditionNotSet = (<div className='flex h-6 items-center space-x-1 rounded-md bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary'>
    {t(`${i18nPrefix}.conditionNotSetup`)}
  </div>)

  return (
    <div className='px-3'>
      {
        cases.map((caseItem, index) => (
          <div key={caseItem.case_id}>
            <div className='relative flex h-6 items-center px-1'>
              <div className='flex w-full items-center justify-between'>
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
                  {
                    checkIsConditionSet(condition)
                      ? (
                        (!isEmptyRelatedOperator(condition.comparison_operator!) && condition.sub_variable_condition)
                          ? (
                            <ConditionFilesListValue condition={condition} />
                          )
                          : (
                            <ConditionValue
                              variableSelector={condition.variable_selector!}
                              operator={condition.comparison_operator!}
                              value={condition.value}
                            />
                          )

                      )
                      : conditionNotSet}
                  {i !== caseItem.conditions.length - 1 && (
                    <div className='absolute bottom-[-10px] right-1 z-10 text-[10px] font-medium uppercase leading-4 text-text-accent'>{t(`${i18nPrefix}.${caseItem.logical_operator}`)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      }
      <div className='relative flex h-6 items-center px-1'>
        <div className='w-full text-right text-xs font-semibold text-text-secondary'>ELSE</div>
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
