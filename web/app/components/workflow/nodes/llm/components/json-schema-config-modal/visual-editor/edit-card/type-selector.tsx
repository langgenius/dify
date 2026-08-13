import type { FC } from 'react'
import type { ArrayType, Type } from '../../../../types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { RiCheckLine } from '@remixicon/react'
import { useState } from 'react'

export type TypeItem = {
  value: Type | ArrayType
  text: string
}

type TypeSelectorProps = {
  items: TypeItem[]
  currentValue: Type | ArrayType
  onSelect: (item: TypeItem) => void
  popupClassName?: string
}

const TypeSelector: FC<TypeSelectorProps> = ({ items, currentValue, onSelect, popupClassName }) => {
  const [open, setOpen] = useState(false)

  return (
    <Select<Type | ArrayType>
      open={open}
      onOpenChange={setOpen}
      value={currentValue}
      onValueChange={(nextValue) => {
        const selected = items.find((item) => item.value === nextValue)
        if (selected) onSelect(selected)
      }}
    >
      <SelectTrigger className="h-auto w-auto rounded-[5px] bg-transparent p-0.5 pl-1 hover:bg-state-base-hover data-popup-open:bg-state-base-hover">
        <SelectValue className="system-xs-medium text-text-tertiary" />
      </SelectTrigger>
      <SelectContent
        sideOffset={4}
        className={popupClassName}
        popupClassName="w-40 rounded-xl border-[0.5px] p-1 shadow-lg shadow-shadow-shadow-5"
        listClassName="p-0"
      >
        {items.map((item) => (
          <SelectItem<Type | ArrayType>
            key={item.value}
            value={item.value}
            className="gap-x-1 rounded-lg px-2 py-1"
            render={(props, state) => (
              <div {...props} className={props.className}>
                <SelectItemText className="px-1 system-sm-medium text-text-secondary">
                  {item.text}
                </SelectItemText>
                {state.selected && <RiCheckLine className="size-4 text-text-accent" />}
                <SelectItemIndicator className="hidden" />
              </div>
            )}
          />
        ))}
      </SelectContent>
    </Select>
  )
}

export default TypeSelector
