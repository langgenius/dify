'use client'
import type { FC } from 'react'
import type { InputVarType } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
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
  popupInnerClassName,
  readonly,
}) => {
  const selectedItem = value ? items.find(item => item.value === value) : undefined

  return (
    <Select
      value={selectedItem?.value}
      readOnly={readonly}
      onValueChange={(nextValue) => {
        const selected = items.find(item => item.value === nextValue)
        if (selected)
          onSelect(selected)
      }}
    >
      <SelectTrigger
        className={cn(
          'h-9 rounded-lg px-2 text-sm',
          readonly ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
        title={selectedItem?.name}
      >
        <div className="flex min-w-0 items-center justify-between">
          <div className="flex items-center">
            <InputVarTypeIcon type={selectedItem?.value as InputVarType} className="size-4 shrink-0 text-text-secondary" />
            <span
              className={`
              ml-1.5 text-components-input-text-filled ${!selectedItem?.name && 'text-components-input-text-placeholder'}
            `}
            >
              {selectedItem?.name}
            </span>
          </div>
          <div className="ml-2 flex shrink-0 items-center space-x-1">
            <Badge uppercase={false}>{inputVarTypeToVarType(selectedItem?.value as InputVarType)}</Badge>
          </div>
        </div>
      </SelectTrigger>
      <SelectContent
        sideOffset={4}
        popupClassName={cn('w-[432px] rounded-md px-1 py-1 text-base sm:text-sm', popupInnerClassName)}
        listClassName="max-h-80 p-0"
      >
        {items.map((item: Item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="h-9 justify-between px-2 text-text-secondary"
            title={item.name}
          >
            <SelectItemText
              className="flex items-center space-x-2 px-0"
            >
              <InputVarTypeIcon type={item.value} className="size-4 shrink-0 text-text-secondary" />
              <span title={item.name}>{item.name}</span>
            </SelectItemText>
            <Badge uppercase={false}>{inputVarTypeToVarType(item.value)}</Badge>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default TypeSelector
