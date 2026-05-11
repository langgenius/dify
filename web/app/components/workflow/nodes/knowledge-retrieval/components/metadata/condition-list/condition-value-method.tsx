import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { capitalize } from 'es-toolkit/string'
import { useState } from 'react'

export type ConditionValueMethodProps = {
  valueMethod?: string
  onValueMethodChange: (v: string) => void
}
const options = [
  'variable',
  'constant',
]
const ConditionValueMethod = ({
  valueMethod = 'variable',
  onValueMethodChange,
}: ConditionValueMethodProps) => {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        render={(
          <Button
            className="shrink-0"
            variant="ghost"
            size="small"
          >
            {capitalize(valueMethod)}
            <RiArrowDownSLine className="ml-px h-3.5 w-3.5" />
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-[112px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          {
            options.map(option => (
              <div
                key={option}
                className={cn(
                  'flex h-7 cursor-pointer items-center rounded-md px-3 hover:bg-state-base-hover',
                  'text-[13px] font-medium text-text-secondary',
                  valueMethod === option && 'bg-state-base-hover',
                )}
                onClick={() => {
                  if (valueMethod === option)
                    return
                  onValueMethodChange(option)
                  setOpen(false)
                }}
              >
                {capitalize(option)}
              </div>
            ))
          }
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ConditionValueMethod
