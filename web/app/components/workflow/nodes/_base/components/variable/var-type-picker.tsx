'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import * as React from 'react'
import { VarType } from '@/app/components/workflow/types'

type Props = Readonly<{
  className?: string
  readonly: boolean
  value: VarType
  onChange: (value: VarType) => void
}>

const TYPES = [
  VarType.string,
  VarType.number,
  VarType.boolean,
  VarType.arrayNumber,
  VarType.arrayString,
  VarType.arrayBoolean,
  VarType.arrayObject,
  VarType.object,
]
const VarReferencePicker: FC<Props> = ({ readonly, className, value, onChange }) => {
  return (
    <div className={cn(className, !readonly && 'cursor-pointer select-none')}>
      <Select<VarType>
        value={value}
        readOnly={readonly}
        onValueChange={(type) => {
          if (type) onChange(type)
        }}
      >
        <SelectTrigger
          className="h-8 w-30 cursor-pointer rounded-lg px-2.5 text-[13px] text-text-primary"
          title={value}
        >
          <SelectValue className="capitalize" />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner sideOffset={4}>
            <SelectPopup className="w-[120px] rounded-lg border-0 p-1 shadow-sm">
              <SelectList className="p-0">
                {TYPES.map((type) => (
                  <SelectItem<VarType>
                    key={type}
                    value={type}
                    className="h-7.5 rounded-lg pr-2 pl-3 text-[13px] text-text-primary"
                  >
                    <SelectItemText className="px-0 capitalize">{type}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </div>
  )
}
export default React.memo(VarReferencePicker)
