'use client'
import type { FC } from 'react'
import type { InputVarType } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import Badge from '@/app/components/base/badge'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { inputVarTypeToVarType } from '@/app/components/workflow/nodes/_base/components/variable/utils'

export type Item = {
  value: InputVarType
  name: string
}

type Props = {
  value: string | number
  onSelect: (value: Item) => void
  items: Item[]
  popupClassName?: string
  popupInnerClassName?: string
  readonly?: boolean
  hideChecked?: boolean
}
const TypeSelector: FC<Props> = ({
  value,
  onSelect,
  items,
  popupClassName,
  popupInnerClassName,
  readonly,
}) => {
  const selectedItem = value ? items.find(item => `${item.value}` === `${value}`) : undefined

  return (
    <Select
      value={selectedItem ? `${selectedItem.value}` : null}
      readOnly={readonly}
      onValueChange={(nextValue) => {
        if (!nextValue)
          return

        const nextItem = items.find(item => `${item.value}` === nextValue)
        if (nextItem)
          onSelect(nextItem)
      }}
    >
      <SelectTrigger className="h-9 rounded-lg px-2 text-sm" title={selectedItem?.name}>
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center">
            <InputVarTypeIcon type={selectedItem?.value as InputVarType} className="size-4 shrink-0 text-text-secondary" />
            <span
              className={cn(
                'ml-1.5 truncate text-components-input-text-filled',
                !selectedItem?.name && 'text-components-input-text-placeholder',
              )}
            >
              {selectedItem?.name}
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            <Badge uppercase={false}>{inputVarTypeToVarType(selectedItem?.value as InputVarType)}</Badge>
          </div>
        </div>
      </SelectTrigger>
      <SelectContent
        placement="bottom-start"
        sideOffset={4}
        className={popupClassName}
        popupClassName={cn('w-(--anchor-width) text-base sm:text-sm', popupInnerClassName)}
        listClassName="p-1"
      >
        {items.map((item: Item) => (
          <SelectItem
            key={item.value}
            value={`${item.value}`}
            className="h-9 justify-between px-2"
            title={item.name}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex min-w-0 items-center space-x-2">
                <InputVarTypeIcon type={item.value} className="size-4 shrink-0 text-text-secondary" />
                <SelectItemText title={item.name} className="mr-0 px-0">{item.name}</SelectItemText>
              </div>
              <Badge uppercase={false}>{inputVarTypeToVarType(item.value)}</Badge>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default TypeSelector
