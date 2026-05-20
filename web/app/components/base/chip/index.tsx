import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine, RiCheckLine, RiCloseCircleFill, RiFilter3Line } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type ItemValue = number | string

export type Item<T extends ItemValue = ItemValue> = {
  value: T
  name: string
} & Record<string, unknown>

type Props<T extends ItemValue> = {
  className?: string
  panelClassName?: string
  showLeftIcon?: boolean
  leftIcon?: ReactNode
  value: T
  items: Item<T>[]
  onSelect: (item: Item<T>) => void
  onClear: () => void
}

function Chip<T extends ItemValue>({
  className,
  panelClassName,
  showLeftIcon = true,
  leftIcon,
  value,
  items,
  onSelect,
  onClear,
}: Props<T>) {
  const { t } = useTranslation()
  const triggerContent = useMemo(() => {
    return items.find(item => item.value === value)?.name || ''
  }, [items, value])

  return (
    <DropdownMenu>
      <div className="relative">
        <div
          className={cn(
            'flex min-h-8 cursor-pointer items-center rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt',
            !value && 'has-data-popup-open:bg-state-base-hover-alt! has-data-popup-open:hover:bg-state-base-hover-alt',
            !!value && 'border-components-button-secondary-border! bg-components-button-secondary-bg! shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover! has-data-popup-open:border-components-button-secondary-border-hover! has-data-popup-open:bg-components-button-secondary-bg-hover! has-data-popup-open:hover:border-components-button-secondary-border-hover has-data-popup-open:hover:bg-components-button-secondary-bg-hover!',
            className,
          )}
        >
          <DropdownMenuTrigger className="flex min-w-0 grow items-center border-none bg-transparent p-0 text-left">
            {showLeftIcon && (
              <div className="p-0.5">
                {leftIcon || (
                  <RiFilter3Line className={cn('size-4 text-text-tertiary', !!value && 'text-text-secondary')} />
                )}
              </div>
            )}
            <div className="flex grow items-center gap-0.5 first-line:p-1">
              <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                {triggerContent}
              </div>
            </div>
            {!value && <RiArrowDownSLine className="size-4 text-text-tertiary" />}
          </DropdownMenuTrigger>
          {!!value && (
            <button
              type="button"
              aria-label={t('operation.clear', { ns: 'common' })}
              className="group/clear cursor-pointer border-none bg-transparent p-px"
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
            >
              <RiCloseCircleFill className="size-3.5 text-text-quaternary group-hover/clear:text-text-tertiary" />
            </button>
          )}
        </div>
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
                {value === item.value && <RiCheckLine className="size-4 shrink-0 text-util-colors-blue-light-blue-light-600" />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </div>
    </DropdownMenu>

  )
}

export default Chip
