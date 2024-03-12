'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import cn from 'classnames'
import Item from './condition-item'
import type { Condition, LogicalOperator } from '@/app/components/workflow/nodes/if-else/types'

type Props = {
  nodeId: string
  className?: string
  readonly: boolean
  list: Condition[]
  onChange: (newList: Condition[]) => void
  logicalOperator: LogicalOperator
  onLogicalOperatorToggle: () => void
}

const ConditionList: FC<Props> = ({
  className,
  readonly,
  nodeId,
  list,
  onChange,
  logicalOperator,
  onLogicalOperatorToggle,
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
        onChange={handleItemChange(0)}
        canRemove={canRemove}
        onRemove={handleItemRemove(0)}
        logicalOperator={logicalOperator}
        onLogicalOperatorToggle={onLogicalOperatorToggle}
      />
      {
        list.length > 1 && (
          list.slice(1).map((item, i) => (
            <Item
              key={item.id}
              readonly={readonly}
              nodeId={nodeId}
              payload={item}
              onChange={handleItemChange(i + 1)}
              canRemove={canRemove}
              onRemove={handleItemRemove(i + 1)}
              isShowLogicalOperator
              logicalOperator={logicalOperator}
              onLogicalOperatorToggle={onLogicalOperatorToggle}
            />
          )))
      }
    </div>
  )
}
export default React.memo(ConditionList)
