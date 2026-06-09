'use client'
import type { FC } from 'react'
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
import { VarType } from '@/app/components/workflow/types'

type Props = {
  className?: string
  readonly: boolean
  value: string
  onChange: (value: string) => void
}

const TYPES = [VarType.string, VarType.number, VarType.boolean, VarType.arrayNumber, VarType.arrayString, VarType.arrayBoolean, VarType.arrayObject, VarType.object]
const VarReferencePicker: FC<Props> = ({
  readonly,
  className,
  value,
  onChange,
}) => {
  return (
    <div className={cn(className, !readonly && 'cursor-pointer select-none')}>
      <Select
        value={value}
        readOnly={readonly}
        onValueChange={(type) => {
          if (type)
            onChange(type)
        }}
      >
        <SelectTrigger
          className="h-8 w-[120px] cursor-pointer rounded-lg px-2.5 text-[13px] text-text-primary"
          title={value}
        >
          <span className="capitalize">{value}</span>
        </SelectTrigger>
        <SelectContent
          sideOffset={4}
          popupClassName="w-[120px] rounded-lg border-0 p-1 shadow-sm"
          listClassName="p-0"
        >
          {TYPES.map(type => (
            <SelectItem
              key={type}
              value={type}
              className="h-[30px] rounded-lg pr-2 pl-3 text-[13px] text-text-primary"
            >
              <SelectItemText className="px-0 capitalize">{type}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
export default React.memo(VarReferencePicker)
