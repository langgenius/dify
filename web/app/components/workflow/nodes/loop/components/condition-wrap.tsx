'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import type { Condition, HandleAddCondition, HandleAddSubVariableCondition, HandleRemoveCondition, HandleToggleConditionLogicalOperator, HandleToggleSubVariableConditionLogicalOperator, HandleUpdateCondition, HandleUpdateSubVariableCondition, LogicalOperator, handleRemoveSubVariableCondition } from '../types'
import type { Node, NodeOutPutVar, Var } from '../../../types'
import { VarType } from '../../../types'
import { useGetAvailableVars } from '../../variable-assigner/hooks'
import ConditionList from './condition-list'
import ConditionAdd from './condition-add'
import { SUB_VARIABLES } from './../default'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import { PortalSelect as Select } from '@/app/components/base/select'

type Props = {
  isSubVariable?: boolean
  conditionId?: string
  conditions: Condition[]
  logicalOperator: LogicalOperator | undefined
  readOnly: boolean
  handleAddCondition?: HandleAddCondition
  handleRemoveCondition?: HandleRemoveCondition
  handleUpdateCondition?: HandleUpdateCondition
  handleToggleConditionLogicalOperator?: HandleToggleConditionLogicalOperator
  handleAddSubVariableCondition?: HandleAddSubVariableCondition
  handleRemoveSubVariableCondition?: handleRemoveSubVariableCondition
  handleUpdateSubVariableCondition?: HandleUpdateSubVariableCondition
  handleToggleSubVariableConditionLogicalOperator?: HandleToggleSubVariableConditionLogicalOperator
  nodeId: string
  availableNodes: Node[]
  availableVars: NodeOutPutVar[]
}

const ConditionWrap: FC<Props> = ({
  isSubVariable,
  conditionId,
  conditions,
  logicalOperator,
  nodeId: id = '',
  readOnly,
  handleUpdateCondition,
  handleAddCondition,
  handleRemoveCondition,
  handleToggleConditionLogicalOperator,
  handleAddSubVariableCondition,
  handleRemoveSubVariableCondition,
  handleUpdateSubVariableCondition,
  handleToggleSubVariableConditionLogicalOperator,
  availableNodes = [],
  availableVars = [],
}) => {
  const { t } = useTranslation()

  const getAvailableVars = useGetAvailableVars()

  const filterNumberVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.number
  }, [])

  const subVarOptions = SUB_VARIABLES.map(item => ({
    name: item,
    value: item,
  }))

  if (!conditions)
    return <div />

  return (
    <>
      <div>
        <div
          className={cn(
            'group relative rounded-[10px] bg-components-panel-bg',
            !isSubVariable && 'py-1 px-3 min-h-[40px] ',
            isSubVariable && 'px-1 py-2',
          )}
        >
          {
            conditions && !!conditions.length && (
              <div className='mb-2'>
                <ConditionList
                  disabled={readOnly}
                  conditionId={conditionId}
                  conditions={conditions}
                  logicalOperator={logicalOperator}
                  onUpdateCondition={handleUpdateCondition}
                  onRemoveCondition={handleRemoveCondition}
                  onToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
                  nodeId={id}
                  availableNodes={availableNodes}
                  numberVariables={getAvailableVars(id, '', filterNumberVar)}
                  onAddSubVariableCondition={handleAddSubVariableCondition}
                  onRemoveSubVariableCondition={handleRemoveSubVariableCondition}
                  onUpdateSubVariableCondition={handleUpdateSubVariableCondition}
                  onToggleSubVariableConditionLogicalOperator={handleToggleSubVariableConditionLogicalOperator}
                  isSubVariable={isSubVariable}
                  availableVars={availableVars}
                />
              </div>
            )
          }

          <div className={cn(
            'flex items-center justify-between pr-[30px]',
            !conditions.length && !isSubVariable && 'mt-1',
            !conditions.length && isSubVariable && 'mt-2',
            conditions.length > 1 && !isSubVariable && 'ml-[60px]',
          )}>
            {isSubVariable
              ? (
                <Select
                  popupInnerClassName='w-[165px] max-h-none'
                  onSelect={value => handleAddSubVariableCondition?.(conditionId!, value.value as string)}
                  items={subVarOptions}
                  value=''
                  renderTrigger={() => (
                    <Button
                      size='small'
                      disabled={readOnly}
                    >
                      <RiAddLine className='mr-1 w-3.5 h-3.5' />
                      {t('workflow.nodes.ifElse.addSubVariable')}
                    </Button>
                  )}
                  hideChecked
                />
              )
              : (
                <ConditionAdd
                  disabled={readOnly}
                  variables={availableVars}
                  onSelectVariable={handleAddCondition!}
                />
              )}
          </div>
        </div>
        {!isSubVariable && (
          <div className='my-2 mx-3 h-[1px] bg-divider-subtle'></div>
        )}
      </div>
    </>
  )
}

export default React.memo(ConditionWrap)
