'use client'

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { produce } from 'immer'
import Switch from '@/app/components/base/switch'
import ConditionAdd from './condition-add'
import ConditionList from './condition-list'
import type {
  AgentToolActivationCondition,
  AgentToolCondition,
} from '../../types'
import { AgentToolConditionLogicalOperator } from '../../types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import {
  getConditionOperators,
  getDefaultValueByType,
  operatorNeedsValue,
} from '../../utils'
import cn from '@/utils/classnames'

type Props = {
  value?: AgentToolActivationCondition
  onChange: (value: AgentToolActivationCondition | undefined) => void
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  disabled?: boolean
}

const AgentToolConditionEditor = ({
  value,
  onChange,
  availableVars,
  availableNodes,
  disabled,
}: Props) => {
  const { t } = useTranslation()

  const currentValue = useMemo<AgentToolActivationCondition>(() => value ?? ({
    enabled: false,
    logical_operator: AgentToolConditionLogicalOperator.And,
    conditions: [],
  }), [value])

  const handleToggle = useCallback((state: boolean) => {
    const next = produce(currentValue, (draft) => {
      draft.enabled = state
    })
    onChange(next)
  }, [currentValue, onChange])

  const handleAddCondition = useCallback((valueSelector: ValueSelector, varItem: Var) => {
    const operators = getConditionOperators(varItem.type)
    const defaultOperator = operators[0]
    const newCondition: AgentToolCondition = {
      id: uuid4(),
      varType: varItem.type ?? VarType.string,
      variable_selector: valueSelector,
      comparison_operator: defaultOperator,
      value: operatorNeedsValue(defaultOperator) ? getDefaultValueByType(varItem.type ?? VarType.string) : undefined,
    }
    const next = produce(currentValue, (draft) => {
      draft.enabled = true
      draft.conditions.push(newCondition)
    })
    onChange(next)
  }, [currentValue, onChange])

  const handleConditionChange = useCallback((updated: AgentToolCondition) => {
    const next = produce(currentValue, (draft) => {
      const targetIndex = draft.conditions.findIndex(item => item.id === updated.id)
      if (targetIndex !== -1)
        draft.conditions[targetIndex] = updated
    })
    onChange(next)
  }, [currentValue, onChange])

  const handleRemoveCondition = useCallback((conditionId: string) => {
    const next = produce(currentValue, (draft) => {
      draft.conditions = draft.conditions.filter(item => item.id !== conditionId)
    })
    onChange(next)
  }, [currentValue, onChange])

  const handleToggleLogicalOperator = useCallback(() => {
    const next = produce(currentValue, (draft) => {
      draft.logical_operator = draft.logical_operator === AgentToolConditionLogicalOperator.And
        ? AgentToolConditionLogicalOperator.Or
        : AgentToolConditionLogicalOperator.And
    })
    onChange(next)
  }, [currentValue, onChange])

  const isEnabled = currentValue.enabled
  const hasConditions = currentValue.conditions.length > 0

  return (
    <div className=''>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <div className='system-sm-semibold text-text-primary'>{t('workflow.nodes.agent.toolCondition.title')}</div>
          <div className='system-xs-regular text-text-tertiary'>{t('workflow.nodes.agent.toolCondition.description')}</div>
        </div>
        <Switch
          defaultValue={isEnabled}
          onChange={handleToggle}
          disabled={disabled}
        />
      </div>

      {isEnabled && (
        <div className='space-y-3'>
          <div className='rounded-[10px] bg-components-panel-bg px-3 py-2'>
            {hasConditions && (
              <div className='mb-2'>
                <ConditionList
                  conditions={currentValue.conditions}
                  logicalOperator={currentValue.logical_operator}
                  availableVars={availableVars}
                  availableNodes={availableNodes}
                  disabled={disabled}
                  onChange={handleConditionChange}
                  onRemove={handleRemoveCondition}
                  onToggleLogicalOperator={handleToggleLogicalOperator}
                />
              </div>
            )}
            <div className={cn(
              'flex items-center justify-between pr-[30px]',
              hasConditions && currentValue.conditions.length > 1 && 'ml-[60px]',
              !hasConditions && 'mt-1',
            )}>
              <ConditionAdd
                variables={availableVars}
                onSelect={handleAddCondition}
                disabled={disabled}
              />
            </div>
          </div>
          {!hasConditions && (
            <div className='system-xs-regular text-text-tertiary'>
              {t('workflow.nodes.agent.toolCondition.addFirstCondition')}
            </div>
          )}
          {hasConditions && currentValue.conditions.length <= 1 && (
            <div className='system-xs-regular text-text-tertiary'>
              {t('workflow.nodes.agent.toolCondition.singleConditionTip')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AgentToolConditionEditor
