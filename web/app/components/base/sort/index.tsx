import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'

type SortItem<Field extends string | number> = {
  value: Field
  name: string
}

export type SortValue<Field extends string | number> = {
  field: Field
  order: 'asc' | 'desc'
}

type SortProps<Field extends string | number> = Readonly<{
  value: SortValue<NoInfer<Field>>
  items: readonly SortItem<Field>[]
  onValueChange: (value: SortValue<NoInfer<Field>>) => void
}>

export function Sort<const Field extends string | number>({
  value,
  items,
  onValueChange,
}: SortProps<Field>) {
  const { t } = useTranslation(['common'])
  const nextOrder = value.order === 'desc' ? 'asc' : 'desc'
  const nextOrderLabel =
    nextOrder === 'asc'
      ? t(($) => $['sorting.ascending'], { ns: 'common' })
      : t(($) => $['sorting.descending'], { ns: 'common' })
  const triggerContent = items.find((item) => item.value === value.field)?.name ?? ''

  return (
    <div className="inline-flex w-fit max-w-full min-w-0 items-center gap-px">
      <DropdownMenu>
        <div className="relative min-w-0 flex-1">
          <DropdownMenuTrigger className="flex min-h-8 w-full min-w-0 items-center rounded-s-lg border-none bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt! data-popup-open:hover:bg-state-base-hover-alt">
            <span className="flex min-w-0 items-center gap-0.5 px-1">
              <span className="system-sm-regular text-text-secondary">
                {t(($) => $['sorting.sortBy'], { ns: 'common' })}
              </span>
              <span className="min-w-0 system-sm-regular wrap-anywhere text-text-secondary">
                {triggerContent}
              </span>
            </span>
            <span
              aria-hidden
              className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-start"
            sideOffset={4}
            className="relative w-60 p-0"
          >
            <DropdownMenuRadioGroup<Field>
              value={value.field}
              onValueChange={(field) => onValueChange({ field, order: value.order })}
              className="max-h-72 overflow-auto p-1"
            >
              {items.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  closeOnClick
                  className="mx-0 h-auto min-h-8 gap-2 py-1.5"
                >
                  <div className="min-w-0 grow system-sm-medium wrap-anywhere text-text-secondary">
                    {item.name}
                  </div>
                  <DropdownMenuRadioItemIndicator className="text-util-colors-blue-light-blue-light-600 forced-colors:text-[CanvasText] forced-colors:forced-color-adjust-none" />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </div>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <IconButton
              aria-label={nextOrderLabel}
              data-order={value.order}
              variant="tertiary"
              size="lg"
              className="group/sort-order shrink-0 rounded-s-none"
              onClick={() => onValueChange({ field: value.field, order: nextOrder })}
            >
              <span
                aria-hidden
                className="grid size-4 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
              >
                <span className="col-start-1 row-start-1 i-ri-sort-asc size-4 scale-95 opacity-0 transition-[opacity,scale] duration-150 ease-out group-data-[order=asc]/sort-order:scale-100 group-data-[order=asc]/sort-order:opacity-100 motion-reduce:transition-none" />
                <span className="col-start-1 row-start-1 i-ri-sort-desc size-4 scale-95 opacity-0 transition-[opacity,scale] duration-150 ease-out group-data-[order=desc]/sort-order:scale-100 group-data-[order=desc]/sort-order:opacity-100 motion-reduce:transition-none" />
              </span>
            </IconButton>
          }
        />
        <TooltipContent>{nextOrderLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}
