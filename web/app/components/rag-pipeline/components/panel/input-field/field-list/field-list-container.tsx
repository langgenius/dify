import type { SortableItem } from './types'
import type { InputVar } from '@/models/pipeline'
import { isEqual } from 'es-toolkit/predicate'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { ReactSortable } from 'react-sortablejs'
import { cn } from '@/utils/classnames'
import FieldItem from './field-item'

type FieldListContainerProps = {
  className?: string
  inputFields: InputVar[]
  onListSortChange: (list: SortableItem[]) => void
  onRemoveField: (index: number) => void
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
        chosen: false,
        selected: false,
        ...content,
      })
    })
  }, [inputFields])

  const handleListSortChange = useCallback((newList: SortableItem[]) => {
    if (isEqual(newList, list))
      return
    onListSortChange(newList)
  }, [list, onListSortChange])

  return (
    <ReactSortable<SortableItem>
      className={cn(className)}
      list={list}
      setList={handleListSortChange}
      handle=".handle"
      ghostClass="opacity-50"
      animation={150}
      disabled={readonly}
    >
      {inputFields?.map((item, index) => (
        <FieldItem
          key={index}
          index={index}
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
