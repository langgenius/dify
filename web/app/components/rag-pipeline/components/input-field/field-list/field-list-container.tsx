import {
  memo,
  useMemo,
} from 'react'
import { ReactSortable } from 'react-sortablejs'
import cn from '@/utils/classnames'
import type { InputVar } from '@/models/pipeline'
import FieldItem from './field-item'
import type { SortableItem } from './types'

type FieldListContainerProps = {
  className?: string
  inputFields: InputVar[]
  onListSortChange: (list: SortableItem[]) => void
  onRemoveField: (id: string) => void
  onEditField: (id: string) => void
  readonly?: boolean
}
const FieldListContainer = ({
  className,
  inputFields,
  onListSortChange,
  onRemoveField,
  onEditField,
  readonly,
}: FieldListContainerProps) => {
  const list = useMemo(() => {
    return inputFields.map((content) => {
      return ({
        id: content.variable,
        name: content.variable,
      })
    })
  }, [inputFields])

  return (
    <ReactSortable<SortableItem>
      className={cn(className)}
      list={list}
      setList={onListSortChange}
      handle='.handle'
      ghostClass='opacity-50'
      animation={150}
      disabled={readonly}
    >
      {inputFields?.map((item, index) => (
        <FieldItem
          key={index}
          readonly={readonly}
          payload={item}
          onRemove={onRemoveField}
          onClickEdit={onEditField}
        />
      ))}
    </ReactSortable>
  )
}

export default memo(FieldListContainer)
