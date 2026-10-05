import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Item = {
  value: number | string
  name: string
} & Record<string, unknown>

type Props = Readonly<{
  order?: string
  value: number | string
  items: Item[]
  onSelect: (value: string) => void
}>

function Sort({ order, value, items, onSelect }: Props) {
  const { t } = useTranslation(['appLog'])

  const triggerContent = useMemo(() => {
    return items.find((item) => item.value === value)?.name || ''
  }, [items, value])

  return (
    <div className="inline-flex max-w-full min-w-0 items-center gap-px">
      <DropdownMenu>
        <div className="relative min-w-0 flex-1">
          <DropdownMenuTrigger className="flex min-h-8 min-w-0 cursor-pointer items-center rounded-l-lg border-none bg-components-input-bg-normal px-2 py-1 outline-hidden hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt! data-popup-open:hover:bg-state-base-hover-alt">
            <div className="flex min-w-0 items-center gap-0.5 px-1">
              <div className="system-sm-regular text-text-tertiary">
                {t(($) => $['filter.sortBy'], { ns: 'appLog' })}
              </div>
              <div
                className={cn(
                  'min-w-0 system-sm-regular break-words text-text-tertiary',
                  !!value && 'text-text-secondary',
                )}
              >
                {triggerContent}
              </div>
            </div>
            <span
              aria-hidden
              className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-start"
            sideOffset={4}
            className="relative w-60 p-0"
          >
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(nextValue) => onSelect(`${order}${nextValue}`)}
              className="max-h-72 overflow-auto p-1"
            >
              {items.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  closeOnClick
                  className="mx-0 gap-2 py-1.5"
                >
                  <div
                    title={item.name}
                    className="grow truncate system-sm-medium text-text-secondary"
                  >
                    {item.name}
                  </div>
                  <DropdownMenuRadioItemIndicator className="text-util-colors-blue-light-blue-light-600" />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </div>
      </DropdownMenu>
      <button
        type="button"
        aria-label={t(($) => $[`filter.${order ? 'ascending' : 'descending'}`], { ns: 'appLog' })}
        className="shrink-0 cursor-pointer rounded-r-lg border-none bg-components-button-tertiary-bg p-2 outline-hidden hover:bg-components-button-tertiary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => onSelect(`${order ? '' : '-'}${value}`)}
      >
        {!order && (
          <span aria-hidden className="i-ri-sort-asc size-4 text-components-button-tertiary-text" />
        )}
        {order && (
          <span
            aria-hidden
            className="i-ri-sort-desc size-4 text-components-button-tertiary-text"
          />
        )}
      </button>
    </div>
  )
}

export default Sort
