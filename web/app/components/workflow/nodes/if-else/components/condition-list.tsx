'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import cn from 'classnames'
import type { Var, VarType } from '../../../types'
import Item from './condition-item'
import type { Condition, LogicalOperator } from '@/app/components/workflow/nodes/if-else/types'

type Props = {
  nodeId: string
  className?: string
  readonly: boolean
  list: Condition[]
  varTypesList: (VarType | undefined)[]
  onChange: (newList: Condition[]) => void
  logicalOperator: LogicalOperator
  onLogicalOperatorToggle: () => void
  filterVar: (varPayload: Var) => boolean
}

const ConditionList: FC<Props> = ({
  className,
  readonly,
  nodeId,
  list,
  varTypesList,
  onChange,
  logicalOperator,
  onLogicalOperatorToggle,
  filterVar,
}) => {
  const handleItemChange = useCallback((index: number) => {
    return (newItem: Condition) => {
      const newList = produce(list, (draft) => {
        draft[index] = newItem
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleItemRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  const canRemove = list.length > 1

  if (list.length === 0)
    return null
  return (
    <div className={cn(className, 'space-y-2')}>
      <Item
        readonly={readonly}
        nodeId={nodeId}
        payload={list[0]}
        varType={varTypesList[0]}
        onChange={handleItemChange(0)}
        canRemove={canRemove}
        onRemove={handleItemRemove(0)}
        logicalOperator={logicalOperator}
        onLogicalOperatorToggle={onLogicalOperatorToggle}
        filterVar={filterVar}
      />
      {
        list.length > 1 && (
          list.slice(1).map((item, i) => (
            <Item
              key={item.id}
              readonly={readonly}
              nodeId={nodeId}
              payload={item}
              varType={varTypesList[i + 1]}
              onChange={handleItemChange(i + 1)}
              canRemove={canRemove}
              onRemove={handleItemRemove(i + 1)}
              isShowLogicalOperator
              logicalOperator={logicalOperator}
              onLogicalOperatorToggle={onLogicalOperatorToggle}
              filterVar={filterVar}
            />
          )))
      }
    </div>
  )
}
export default React.memo(ConditionList)
