import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine, RiCheckLine, RiCloseCircleFill, RiFilter3Line } from '@remixicon/react'
import { useMemo, useState } from 'react'

export type Item = {
  value: number | string
  name: string
} & Record<string, any>

type Props = {
  className?: string
  panelClassName?: string
  showLeftIcon?: boolean
  leftIcon?: any
  value: number | string
  items: Item[]
  onSelect: (item: any) => void
  onClear: () => void
}
const Chip: FC<Props> = ({
  className,
  panelClassName,
  showLeftIcon = true,
  leftIcon,
  value,
  items,
  onSelect,
  onClear,
}) => {
  const [open, setOpen] = useState(false)

  const triggerContent = useMemo(() => {
    return items.find(item => item.value === value)?.name || ''
  }, [items, value])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <div className="relative">
        <DropdownMenuTrigger
          nativeButton={false}
          render={<div className="block" />}
        >
          <div className={cn(
            'flex min-h-8 cursor-pointer items-center rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt',
            open && !value && 'bg-state-base-hover-alt! hover:bg-state-base-hover-alt',
            !open && !!value && 'border-components-button-secondary-border! bg-components-button-secondary-bg! shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover!',
            open && !!value && 'border-components-button-secondary-border-hover! bg-components-button-secondary-bg-hover! shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover!',
            className,
          )}
          >
            {showLeftIcon && (
              <div className="p-0.5">
                {leftIcon || (
                  <RiFilter3Line className={cn('h-4 w-4 text-text-tertiary', !!value && 'text-text-secondary')} />
                )}
              </div>
            )}
            <div className="flex grow items-center gap-0.5 first-line:p-1">
              <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                {triggerContent}
              </div>
            </div>
            {!value && <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />}
            {!!value && (
              <div
                className="group/clear cursor-pointer p-px"
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
              >
                <RiCloseCircleFill className="h-3.5 w-3.5 text-text-quaternary group-hover/clear:text-text-tertiary" />
              </div>
            )}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName={cn('relative w-[240px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-0', panelClassName)}
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(nextValue) => {
              const selected = items.find(item => item.value === nextValue)
              if (selected)
                onSelect(selected)
            }}
            className="max-h-72 overflow-auto p-1"
          >
            {items.map(item => (
              <DropdownMenuRadioItem
                key={item.value}
                value={item.value}
                closeOnClick
                className="gap-2 rounded-lg px-2 py-[6px] pl-3"
              >
                <div title={item.name} className="grow truncate system-sm-medium text-text-secondary">{item.name}</div>
                {value === item.value && <RiCheckLine className="h-4 w-4 shrink-0 text-util-colors-blue-light-blue-light-600" />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </div>
    </DropdownMenu>

  )
}

export default Chip
