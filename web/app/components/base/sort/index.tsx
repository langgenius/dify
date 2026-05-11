import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiArrowDownSLine, RiCheckLine, RiSortAsc, RiSortDesc } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Item = {
  value: number | string
  name: string
} & Record<string, any>

type Props = {
  order?: string
  value: number | string
  items: Item[]
  onSelect: (item: any) => void
}
const Sort: FC<Props> = ({
  order,
  value,
  items,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const triggerContent = useMemo(() => {
    return items.find(item => item.value === value)?.name || ''
  }, [items, value])

  return (
    <div className="inline-flex items-center">
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
              'flex min-h-8 cursor-pointer items-center rounded-l-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt',
              open && 'bg-state-base-hover-alt! hover:bg-state-base-hover-alt',
            )}
            >
              <div className="flex items-center gap-0.5 px-1">
                <div className="system-sm-regular text-text-tertiary">{t('filter.sortBy', { ns: 'appLog' })}</div>
                <div className={cn('system-sm-regular text-text-tertiary', !!value && 'text-text-secondary')}>
                  {triggerContent}
                </div>
              </div>
              <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
            </div>
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
                  {value === item.value && <RiCheckLine className="h-4 w-4 shrink-0 text-util-colors-blue-light-blue-light-600" />}
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
        {!order && <RiSortAsc className="h-4 w-4 text-components-button-tertiary-text" aria-hidden="true" />}
        {order && <RiSortDesc className="h-4 w-4 text-components-button-tertiary-text" aria-hidden="true" />}
      </button>
    </div>

  )
}

export default Sort
