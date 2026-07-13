import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  const { t } = useTranslation()

  const triggerContent = useMemo(() => {
    return items.find((item) => item.value === value)?.name || ''
  }, [items, value])

  return (
    <div className="inline-flex items-center">
      <DropdownMenu>
        <div className="relative">
          <DropdownMenuTrigger className="flex min-h-8 cursor-pointer items-center rounded-l-lg border-none bg-components-input-bg-normal px-2 py-1 outline-hidden hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt! data-popup-open:hover:bg-state-base-hover-alt">
            <div className="flex items-center gap-0.5 px-1">
              <div className="system-sm-regular text-text-tertiary">
                {t(($) => $['filter.sortBy'], { ns: 'appLog' })}
              </div>
              <div
                className={cn(
                  'system-sm-regular text-text-tertiary',
                  !!value && 'text-text-secondary',
                )}
              >
                {triggerContent}
              </div>
            </div>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-start"
            sideOffset={4}
            popupClassName="relative w-[240px] rounded-xl bg-components-panel-bg-blur p-0"
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
                  className="mx-0 gap-2 rounded-lg px-2 py-[6px]"
                >
                  <div
                    title={item.name}
                    className="grow truncate system-sm-medium text-text-secondary"
                  >
                    {item.name}
                  </div>
                  {value === item.value && (
                    <span
                      aria-hidden
                      className="i-ri-check-line size-4 shrink-0 text-util-colors-blue-light-blue-light-600"
                    />
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </div>
      </DropdownMenu>
      <button
        type="button"
        aria-label={t(($) => $[`filter.${order ? 'ascending' : 'descending'}`], { ns: 'appLog' })}
        className="ml-px cursor-pointer rounded-r-lg border-none bg-components-button-tertiary-bg p-2 outline-hidden hover:bg-components-button-tertiary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
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
