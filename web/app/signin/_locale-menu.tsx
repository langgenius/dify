import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'

type LocaleMenuItem<T extends string> = {
  value: T
  name: string
}

type LocaleMenuProps<T extends string> = {
  items: Array<LocaleMenuItem<T>>
  value?: T
  onChange?: (value: T) => void
}

export default function LocaleMenu<T extends string>({
  items,
  value,
  onChange,
}: LocaleMenuProps<T>) {
  const selectedItem = items.find(item => item.value === value)
  const handleValueChange = (nextValue: string) => {
    const nextItem = items.find(item => item.value === nextValue)
    if (nextItem)
      onChange?.(nextItem.value)
  }

  return (
    <div className="w-56 text-right">
      <DropdownMenu>
        <div className="relative inline-block text-left">
          <div>
            <DropdownMenuTrigger
              render={(
                <button
                  type="button"
                  className="inline-flex w-full items-center rounded-lg border border-components-button-secondary-border px-[10px] py-[6px] text-[13px] font-medium text-text-primary hover:bg-state-base-hover"
                />
              )}
            >
              <span className="mr-1 i-heroicons-globe-alt h-5 w-5" aria-hidden="true" />
              {selectedItem?.name}
            </DropdownMenuTrigger>
          </div>
        </div>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={8}
          popupClassName="w-[200px]"
        >
          <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
            {items.map(item => (
              <DropdownMenuRadioItem
                key={item.value}
                value={item.value}
                closeOnClick
                className="px-3 py-2 text-sm text-text-secondary"
              >
                <span className="grow truncate">{item.name}</span>
                <DropdownMenuRadioItemIndicator />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
