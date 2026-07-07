import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'

type ItemValue = number | string

export type Item<T extends ItemValue = ItemValue> = {
  value: T
  name: string
  triggerName?: string
} & Record<string, unknown>

type Props<T extends ItemValue> = {
  className?: string
  panelClassName?: string
  showLeftIcon?: boolean
  leftIcon?: ReactNode
  showItemIndicator?: boolean
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
  showItemIndicator = true,
  value,
  items,
  onSelect,
  onClear,
}: Props<T>) {
  const { t } = useTranslation()
  const selectedItem = items.find(item => Object.is(item.value, value))
  const triggerContent = selectedItem?.triggerName || selectedItem?.name || ''
  const hasValue = selectedItem !== undefined && value !== ''
  const clearLabel = triggerContent
    ? `${t('operation.clear', { ns: 'common' })} ${triggerContent}`
    : t('operation.clear', { ns: 'common' })

  return (
    <Select
      value={selectedItem?.value ?? null}
      itemToStringLabel={(itemValue: T) => items.find(item => Object.is(item.value, itemValue))?.name ?? ''}
      itemToStringValue={itemValue => String(itemValue)}
      onValueChange={(nextValue) => {
        if (nextValue === null)
          return
        const selected = items.find(item => Object.is(item.value, nextValue))
        if (selected)
          onSelect(selected)
      }}
    >
      <div className="relative w-fit max-w-full">
        <SelectTrigger
          aria-label={triggerContent || t('placeholder.select', { ns: 'common' })}
          className={cn(
            'h-auto min-h-8 w-fit max-w-full cursor-pointer items-center rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt! data-popup-open:hover:bg-state-base-hover-alt [&>*:last-child]:hidden',
            hasValue && 'border-components-button-secondary-border! bg-components-button-secondary-bg! pr-6 shadow-xs hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover! data-popup-open:border-components-button-secondary-border-hover! data-popup-open:bg-components-button-secondary-bg-hover! data-popup-open:hover:border-components-button-secondary-border-hover data-popup-open:hover:bg-components-button-secondary-bg-hover!',
            className,
          )}
        >
          <span className="flex min-w-0 grow items-center gap-1 text-left">
            {showLeftIcon && (
              <span aria-hidden="true" className="p-0.5">
                {leftIcon || (
                  <span aria-hidden className={cn('i-ri-filter-3-line block size-4 text-text-tertiary', hasValue && 'text-text-secondary')} />
                )}
              </span>
            )}
            <span className="flex grow items-center gap-0.5 first-line:p-1">
              <span className={cn('system-sm-regular text-text-tertiary', hasValue && 'text-text-secondary')}>
                {triggerContent}
              </span>
            </span>
            {!hasValue && <span aria-hidden className="i-ri-arrow-down-s-line block size-4 text-text-tertiary" />}
          </span>
        </SelectTrigger>
        {hasValue && (
          <button
            type="button"
            aria-label={clearLabel}
            className="group/clear absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer touch-manipulation items-center justify-center rounded-md border-none bg-transparent p-0 outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
            onClick={onClear}
          >
            <span aria-hidden className="i-ri-close-circle-fill block size-3.5 text-text-quaternary group-hover/clear:text-text-tertiary" />
          </button>
        )}
        <SelectContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName={cn(
            'relative w-[240px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-0 text-sm text-text-secondary shadow-lg outline-hidden backdrop-blur-[5px] focus:outline-hidden focus-visible:outline-hidden',
            panelClassName,
          )}
          listClassName="max-h-72 p-1"
        >
          {items.map(item => (
            <SelectItem
              key={item.value}
              value={item.value}
            >
              <SelectItemText title={item.name}>{item.name}</SelectItemText>
              {showItemIndicator && <SelectItemIndicator />}
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>

  )
}

export default Chip
