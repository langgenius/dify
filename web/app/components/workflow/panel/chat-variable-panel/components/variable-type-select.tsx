'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useState } from 'react'

type Props<T extends string> = {
  inCell?: boolean
  value?: T
  list: readonly T[]
  onSelect: (value: T) => void
  popupClassName?: string
}

const VariableTypeSelector = <T extends string, >({
  inCell = false,
  value,
  list,
  onSelect,
  popupClassName,
}: Props<T>) => {
  const [open, setOpen] = useState(false)

  const handleValueChange = (nextValue: string | null) => {
    if (!nextValue)
      return

    const nextItem = list.find(item => item === nextValue)
    if (!nextItem)
      return

    onSelect(nextItem)
  }

  return (
    <Select
      value={value ?? null}
      open={open}
      onOpenChange={setOpen}
      onValueChange={handleValueChange}
    >
      <SelectTrigger
        className="h-auto w-full max-w-none cursor-pointer rounded-none bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent data-popup-open:bg-transparent [&>*:last-child]:hidden"
      >
        <div className={cn(
          'flex w-full cursor-pointer items-center px-2',
          !inCell && 'rounded-lg bg-components-input-bg-normal py-1 hover:bg-state-base-hover-alt',
          inCell && 'py-0.5 hover:bg-state-base-hover',
          open && !inCell && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
          open && inCell && 'bg-state-base-hover hover:bg-state-base-hover',
        )}
        >
          <div className={cn(
            'grow truncate p-1 system-sm-regular text-components-input-text-filled',
            inCell && 'system-xs-regular text-text-secondary',
          )}
          >
            {value}
          </div>
          <span className="ml-0.5 i-ri-arrow-down-s-line h-4 w-4 text-text-quaternary" aria-hidden="true" />
        </div>
      </SelectTrigger>
      <SelectContent placement="bottom-start" popupClassName={cn('bg-components-panel-bg-blur', popupClassName)}>
        {list.map(item => (
          <SelectItem
            key={item}
            value={item}
            className="h-auto gap-2 py-[6px] pr-2 pl-3 system-md-regular font-normal"
          >
            <SelectItemText className="px-0 system-md-regular text-text-secondary">{item}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default VariableTypeSelector
