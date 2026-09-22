import type { SortableItem } from './types'
import type { InputVar } from '@/models/pipeline'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback, useMemo } from 'react'
import { ReactSortable } from 'react-sortablejs'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
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
  const { items, getHandleProps, getItemKey, isSorting, announcement } = useKeyboardSortable({
    items: inputFields,
    onChange: (fields) =>
      onListSortChange(
        fields.map((field) => ({ ...field, id: field.variable, chosen: false, selected: false })),
      ),
    disabled: readonly,
    getItemLabel: (item) => item.label || item.variable,
  })
  const list = useMemo(() => {
    return items.map((content) => {
      return {
        id: content.variable,
        chosen: false,
        selected: false,
        ...content,
      }
    })
  }, [items])

  const handleListSortChange = useCallback(
    (newList: SortableItem[]) => {
      if (
        isSorting ||
        (newList.length === inputFields.length &&
          newList.every((item, index) => item.variable === inputFields[index]?.variable))
      )
        return
      onListSortChange(newList)
    },
    [isSorting, inputFields, onListSortChange],
  )

  const moveField = (index: number, direction: -1 | 1) => {
    if (readonly || isSorting) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= list.length) return
    const reordered = [...list]
    const [field] = reordered.splice(index, 1)
    reordered.splice(nextIndex, 0, field!)
    onListSortChange(reordered)
  }

  return (
    <>
      {announcement}
      <ReactSortable<SortableItem>
        className={cn('nokey', className)}
        list={list}
        setList={handleListSortChange}
        handle=".handle"
        ghostClass="opacity-50"
        animation={150}
        disabled={readonly || isSorting}
      >
        {items.map((item, index) => (
          <FieldItem
            key={item.variable}
            dragHandleProps={getHandleProps(index)}
            index={getItemKey(index)}
            readonly={readonly}
            payload={item}
            onRemove={onRemoveField}
            onClickEdit={onEditField}
            onMoveUp={!isSorting && index > 0 ? () => moveField(index, -1) : undefined}
            onMoveDown={
              !isSorting && index < items.length - 1 ? () => moveField(index, 1) : undefined
            }
          />
        ))}
      </ReactSortable>
    </>
  )
}

export default memo(FieldListContainer)
