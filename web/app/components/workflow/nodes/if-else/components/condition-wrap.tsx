'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiDraggable,
} from '@remixicon/react'
import type { CaseItem, HandleAddCondition, HandleAddSubVariableCondition, HandleRemoveCondition, HandleToggleConditionLogicalOperator, HandleToggleSubVariableConditionLogicalOperator, HandleUpdateCondition, HandleUpdateSubVariableCondition, handleRemoveSubVariableCondition } from '../types'
import type { Node, NodeOutPutVar, Var } from '../../../types'
import { VarType } from '../../../types'
import { useGetAvailableVars } from '../../variable-assigner/hooks'
import { SUB_VARIABLES } from '../../constants'
import ConditionList from './condition-list'
import ConditionAdd from './condition-add'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import { PortalSelect as Select } from '@/app/components/base/select'
import { noop } from 'lodash-es'

type Props = {
  isSubVariable?: boolean
  caseId?: string
  conditionId?: string
  cases: CaseItem[]
  readOnly: boolean
  handleSortCase?: (sortedCases: (CaseItem & { id: string })[]) => void
  handleRemoveCase?: (caseId: string) => void
  handleAddCondition?: HandleAddCondition
  handleRemoveCondition?: HandleRemoveCondition
  handleUpdateCondition?: HandleUpdateCondition
  handleToggleConditionLogicalOperator?: HandleToggleConditionLogicalOperator
  handleAddSubVariableCondition?: HandleAddSubVariableCondition
  handleRemoveSubVariableCondition?: handleRemoveSubVariableCondition
  handleUpdateSubVariableCondition?: HandleUpdateSubVariableCondition
  handleToggleSubVariableConditionLogicalOperator?: HandleToggleSubVariableConditionLogicalOperator
  nodeId: string
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  varsIsVarFileAttribute?: Record<string, boolean>
  filterVar: (varPayload: Var) => boolean
}

const ConditionWrap: FC<Props> = ({
  isSubVariable,
  caseId,
  conditionId,
  nodeId: id = '',
  cases = [],
  readOnly,
  handleSortCase = noop,
  handleRemoveCase,
  handleUpdateCondition,
  handleAddCondition,
  handleRemoveCondition,
  handleToggleConditionLogicalOperator,
  handleAddSubVariableCondition,
  handleRemoveSubVariableCondition,
  handleUpdateSubVariableCondition,
  handleToggleSubVariableConditionLogicalOperator,
  nodesOutputVars = [],
  availableNodes = [],
  varsIsVarFileAttribute = {},
  filterVar = () => true,
}) => {
  const { t } = useTranslation()

  const getAvailableVars = useGetAvailableVars()

  const [willDeleteCaseId, setWillDeleteCaseId] = useState('')
  const casesLength = cases.length

  const filterNumberVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.number
  }, [])

  const subVarOptions = SUB_VARIABLES.map(item => ({
    name: item,
    value: item,
  }))

  return (
    <>
      <ReactSortable
        list={cases.map(caseItem => ({ ...caseItem, id: caseItem.case_id }))}
        setList={handleSortCase}
        handle='.handle'
        ghostClass='bg-components-panel-bg'
        animation={150}
        disabled={readOnly || isSubVariable}
      >
        {
          cases.map((item, index) => (
            <div key={item.case_id}>
              <div
                className={cn(
                  'group relative rounded-[10px] bg-components-panel-bg',
                  willDeleteCaseId === item.case_id && 'bg-state-destructive-hover',
                  !isSubVariable && 'min-h-[40px] px-3 py-1 ',
                  isSubVariable && 'px-1 py-2',
                )}
              >
                {!isSubVariable && (
                  <>
                    <RiDraggable className={cn(
                      'handle absolute left-1 top-2 hidden h-3 w-3 cursor-pointer text-text-quaternary',
                      casesLength > 1 && 'group-hover:block',
                    )} />
                    <div className={cn(
                      'absolute left-4 text-[13px] font-semibold leading-4 text-text-secondary',
                      casesLength === 1 ? 'top-2.5' : 'top-1',
                    )}>
                      {
                        index === 0 ? 'IF' : 'ELIF'
                      }
                      {
                        casesLength > 1 && (
                          <div className='text-[10px] font-medium text-text-tertiary'>CASE {index + 1}</div>
                        )
                      }
                    </div>
                  </>
                )}

                {
                  !!item.conditions.length && (
                    <div className='mb-2'>
                      <ConditionList
                        disabled={readOnly}
                        caseItem={item}
                        caseId={isSubVariable ? caseId! : item.case_id}
                        conditionId={conditionId}
                        onUpdateCondition={handleUpdateCondition}
                        onRemoveCondition={handleRemoveCondition}
                        onToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
                        nodeId={id}
                        nodesOutputVars={nodesOutputVars}
                        availableNodes={availableNodes}
                        filterVar={filterVar}
                        numberVariables={getAvailableVars(id, '', filterNumberVar)}
                        varsIsVarFileAttribute={varsIsVarFileAttribute}
                        onAddSubVariableCondition={handleAddSubVariableCondition}
                        onRemoveSubVariableCondition={handleRemoveSubVariableCondition}
                        onUpdateSubVariableCondition={handleUpdateSubVariableCondition}
                        onToggleSubVariableConditionLogicalOperator={handleToggleSubVariableConditionLogicalOperator}
                        isSubVariable={isSubVariable}
                      />
                    </div>
                  )
                }

                <div className={cn(
                  'flex items-center justify-between pr-[30px]',
                  !item.conditions.length && !isSubVariable && 'mt-1',
                  !item.conditions.length && isSubVariable && 'mt-2',
                  !isSubVariable && ' pl-[60px]',
                )}>
                  {isSubVariable
                    ? (
                      <Select
                        popupInnerClassName='w-[165px] max-h-none'
                        onSelect={value => handleAddSubVariableCondition?.(caseId!, conditionId!, value.value as string)}
                        items={subVarOptions}
                        value=''
                        renderTrigger={() => (
                          <Button
                            size='small'
                            disabled={readOnly}
                          >
                            <RiAddLine className='mr-1 h-3.5 w-3.5' />
                            {t('workflow.nodes.ifElse.addSubVariable')}
                          </Button>
                        )}
                        hideChecked
                      />
                    )
                    : (
                      <ConditionAdd
                        disabled={readOnly}
                        caseId={item.case_id}
                        variables={getAvailableVars(id, '', filterVar)}
                        onSelectVariable={handleAddCondition!}
                      />
                    )}

                  {
                    ((index === 0 && casesLength > 1) || (index > 0)) && (
                      <Button
                        className='hover:bg-components-button-destructive-ghost-bg-hover hover:text-components-button-destructive-ghost-text'
                        size='small'
                        variant='ghost'
                        disabled={readOnly}
                        onClick={() => handleRemoveCase?.(item.case_id)}
                        onMouseEnter={() => setWillDeleteCaseId(item.case_id)}
                        onMouseLeave={() => setWillDeleteCaseId('')}
                      >
                        <RiDeleteBinLine className='mr-1 h-3.5 w-3.5' />
                        {t('common.operation.remove')}
                      </Button>
                    )
                  }
                </div>
              </div>
              {!isSubVariable && (
                <div className='mx-3 my-2 h-px bg-divider-subtle'></div>
              )}
            </div>
          ))
        }
      </ReactSortable>
      {(cases.length === 0) && (
        <Button
          size='small'
          disabled={readOnly}
          onClick={() => handleAddSubVariableCondition?.(caseId!, conditionId!)}
        >
          <RiAddLine className='mr-1 h-3.5 w-3.5' />
          {t('workflow.nodes.ifElse.addSubVariable')}
        </Button>
      )}
    </>
  )
}
export default React.memo(ConditionWrap)
