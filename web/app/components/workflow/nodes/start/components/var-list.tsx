'use client'
import type { FC } from 'react'
import React, { useCallback, useRef } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { DndProvider, useDrag, useDrop } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import VarItem from './var-item'
import { type InputVar, type MoreInfo } from '@/app/components/workflow/types'

type Props = {
  readonly: boolean
  list: InputVar[]
  onChange: (newList: InputVar[], moreInfo?: any) => void
}

const ItemTypes = {
  VAR_ITEM: 'VAR_ITEM',
}

type DragItem = {
  index: number
  id: string
  type: string
}

type DraggableVarItemProps = {
  index: number
  item: InputVar
  readonly: boolean
  moveItem: (dragIndex: number, hoverIndex: number) => void
  onChange: (payload: InputVar, moreInfo?: MoreInfo) => void
  onRemove: () => void
  varKeys: string[]
}

const DraggableVarItem: FC<DraggableVarItemProps> = ({
  index,
  item,
  readonly,
  moveItem,
  onChange,
  onRemove,
  varKeys,
}) => {
  const ref = useRef<HTMLDivElement>(null)

  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.VAR_ITEM,
    item: { type: ItemTypes.VAR_ITEM, id: item.variable, index },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
    }),
    canDrag: !readonly,
  })

  const [, drop] = useDrop<DragItem, void, {}>({
    accept: ItemTypes.VAR_ITEM,
    hover(item: DragItem, monitor) {
      if (!ref.current)
        return

      const dragIndex = item.index
      const hoverIndex = index

      if (dragIndex === hoverIndex)
        return

      const hoverBoundingRect = ref.current?.getBoundingClientRect()
      const hoverMiddleY
        = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2
      const clientOffset = monitor.getClientOffset()
      const hoverClientY = clientOffset!.y - hoverBoundingRect.top

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY)
        return
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY)
        return

      moveItem(dragIndex, hoverIndex)
      item.index = hoverIndex
    },
  })

  drag(drop(ref))

  return (
    <div
      ref={ref}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      className="transition-opacity duration-200"
    >
      <VarItem
        readonly={readonly}
        payload={item}
        onChange={onChange}
        onRemove={onRemove}
        varKeys={varKeys}
      />
    </div>
  )
}

const VarList: FC<Props> = ({ readonly, list, onChange }) => {
  const { t } = useTranslation()

  const handleVarChange = useCallback(
    (index: number) => {
      return (payload: InputVar, moreInfo?: MoreInfo) => {
        const newList = produce(list, (draft: InputVar[]) => {
          draft[index] = payload
        })
        onChange(
          newList,
          moreInfo
            ? ({ index, payload: moreInfo } as unknown as MoreInfo)
            : undefined,
        )
      }
    },
    [list, onChange],
  )

  const handleVarRemove = useCallback(
    (index: number) => {
      return () => {
        const newList = produce(list, (draft: InputVar[]) => {
          draft.splice(index, 1)
        })
        onChange(newList, {
          type: 'remove',
          payload: {
            beforeKey: list[index].variable,
          },
        })
      }
    },
    [list, onChange],
  )

  const moveItem = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const newList = produce(list, (draft: InputVar[]) => {
        const dragItem = draft[dragIndex]
        draft.splice(dragIndex, 1)
        draft.splice(hoverIndex, 0, dragItem)
      })

      onChange(newList, {
        type: 'move',
        payload: {
          beforeKey: list[dragIndex].variable,
          afterKey: list[hoverIndex].variable,
        },
      })
    },
    [list, onChange],
  )

  if (list.length === 0) {
    return (
      <div className="flex rounded-md bg-gray-50 items-center h-[42px] justify-center leading-[18px] text-xs font-normal text-gray-500">
        {t('workflow.nodes.start.noVarTip')}
      </div>
    )
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-1">
        {list.map((item: InputVar, index: number) => (
          <DraggableVarItem
            key={item.variable}
            index={index}
            item={item}
            readonly={readonly}
            moveItem={moveItem}
            onChange={handleVarChange(index)}
            onRemove={handleVarRemove(index)}
            varKeys={list.map((item: InputVar) => item.variable)}
          />
        ))}
      </div>
    </DndProvider>
  )
}

export default React.memo(VarList)
