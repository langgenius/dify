'use client'
import type { FC } from 'react'
import type { Node, NodeOutPutVar, Var } from '../../../types'
import type { Condition, HandleAddCondition, HandleAddSubVariableCondition, HandleRemoveCondition, handleRemoveSubVariableCondition, HandleToggleConditionLogicalOperator, HandleToggleSubVariableConditionLogicalOperator, HandleUpdateCondition, HandleUpdateSubVariableCondition, LogicalOperator } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import {
  RiAddLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { VarType } from '../../../types'
import { useGetAvailableVars } from '../../variable-assigner/hooks'
import { SUB_VARIABLES } from './../default'
import ConditionAdd from './condition-add'
import ConditionList from './condition-list'

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
            !isSubVariable && 'min-h-[40px] px-3 py-1',
            isSubVariable && 'px-1 py-2',
          )}
        >
          {
            conditions && !!conditions.length && (
              <div className="mb-2">
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
          )}
          >
            {isSubVariable
              ? (
                  <Select
                    value={null}
                    disabled={readOnly}
                    onValueChange={value => value && handleAddSubVariableCondition?.(conditionId!, value)}
                  >
                    <SelectTrigger
                      render={<div />}
                      nativeButton={false}
                      className="border-0 bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent [&>*:last-child]:hidden"
                    >
                      <Button
                        size="small"
                        disabled={readOnly}
                      >
                        <RiAddLine className="mr-1 h-3.5 w-3.5" />
                        {t('nodes.ifElse.addSubVariable', { ns: 'workflow' })}
                      </Button>
                    </SelectTrigger>
                    <SelectContent popupClassName="w-[165px]" listClassName="max-h-none p-1">
                      {subVarOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          <SelectItemText>{option.name}</SelectItemText>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
      </div>
    </>
  )
}

export default React.memo(ConditionWrap)
