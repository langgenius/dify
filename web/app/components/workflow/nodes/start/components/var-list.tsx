'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import VarItem from './var-item'
import { ChangeType, type InputVar, type MoreInfo } from '@/app/components/workflow/types'
import { v4 as uuid4 } from 'uuid'
import { ReactSortable } from 'react-sortablejs'
import { RiDraggable } from '@remixicon/react'
import cn from '@/utils/classnames'

type Props = {
  readonly: boolean
  list: InputVar[]
  onChange: (list: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => void
}

const VarList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleVarChange = useCallback((index: number) => {
    return (payload: InputVar, moreInfo?: MoreInfo) => {
      const newList = produce(list, (draft) => {
        draft[index] = payload
      })
      onChange(newList, moreInfo ? { index, payload: moreInfo } : undefined)
    }
  }, [list, onChange])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList, {
        index,
        payload: {
          type: ChangeType.remove,
          payload: {
            beforeKey: list[index].variable,
          },
        },
      })
    }
  }, [list, onChange])

  const listWithIds = useMemo(() => list.map((item) => {
    const id = uuid4()
    return {
      id,
      variable: { ...item },
    }
  }), [list])

  const varCount = list.length

  if (list.length === 0) {
    return (
      <div className='flex h-[42px] items-center justify-center rounded-md bg-components-panel-bg text-xs font-normal leading-[18px] text-text-tertiary'>
        {t('workflow.nodes.start.noVarTip')}
      </div>
    )
  }

  return (
    <ReactSortable
      className='space-y-1'
      list={listWithIds}
      setList={(list) => { onChange(list.map(item => item.variable)) }}
      handle='.handle'
      ghostClass='opacity-50'
      animation={150}
    >
      {list.map((item, index) => {
        const canDrag = (() => {
          if (readonly)
            return false
          return varCount > 1
        })()
        return (
          <div key={index} className='group relative'>
            <VarItem
              className={cn(canDrag && 'handle')}
              readonly={readonly}
              payload={item}
              onChange={handleVarChange(index)}
              onRemove={handleVarRemove(index)}
              varKeys={list.map(item => item.variable)}
              canDrag={canDrag}
            />
            {canDrag && <RiDraggable className={cn(
              'handle absolute left-3 top-2.5 hidden h-3 w-3 cursor-pointer text-text-tertiary',
              'group-hover:block',
            )} />}
          </div>
        )
      })}
    </ReactSortable>
  )
}
export default React.memo(VarList)
