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
        ...content,
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
      group='rag-pipeline-input-field'
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
