import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine, RiCheckLine, RiSortAsc, RiSortDesc } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Item = {
  value: number | string
  name: string
} & Record<string, unknown>

type Props = {
  order?: string
  value: number | string
  items: Item[]
  onSelect: (value: string) => void
}

function Sort({
  order,
  value,
  items,
  onSelect,
}: Props) {
  const { t } = useTranslation()

  const triggerContent = useMemo(() => {
    return items.find(item => item.value === value)?.name || ''
  }, [items, value])

  return (
    <div className="inline-flex items-center">
      <DropdownMenu>
        <div className="relative">
          <DropdownMenuTrigger
            className="flex min-h-8 cursor-pointer items-center rounded-l-lg border-none bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt! data-popup-open:hover:bg-state-base-hover-alt"
          >
            <div className="flex items-center gap-0.5 px-1">
              <div className="system-sm-regular text-text-tertiary">{t('filter.sortBy', { ns: 'appLog' })}</div>
              <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                {triggerContent}
              </div>
            </div>
            <RiArrowDownSLine className="size-4 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-start"
            sideOffset={4}
            popupClassName="relative w-[240px] rounded-xl border-[0.5px] bg-components-panel-bg-blur p-0"
          >
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={nextValue => onSelect(`${order}${nextValue}`)}
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
      <button
        type="button"
        aria-label={t(`filter.${order ? 'ascending' : 'descending'}`, { ns: 'appLog' })}
        className="ml-px cursor-pointer rounded-r-lg border-none bg-components-button-tertiary-bg p-2 hover:bg-components-button-tertiary-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={() => onSelect(`${order ? '' : '-'}${value}`)}
      >
        {!order && <RiSortAsc className="size-4 text-components-button-tertiary-text" aria-hidden="true" />}
        {order && <RiSortDesc className="size-4 text-components-button-tertiary-text" aria-hidden="true" />}
      </button>
    </div>

  )
}

export default Sort
