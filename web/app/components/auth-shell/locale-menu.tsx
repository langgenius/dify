import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'

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
  const selectedItem = items.find((item) => item.value === value)

  return (
    <div className="flex min-w-0">
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              className="inline-flex max-w-full min-w-0 items-center rounded-lg border border-components-button-secondary-border px-2.5 py-1.5 text-[13px] font-medium text-text-primary hover:bg-state-base-hover"
            />
          }
        >
          <span className="me-1 i-heroicons-globe-alt size-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{selectedItem?.name}</span>
        </MenuTrigger>
        <MenuContent sideOffset={8} className="w-50">
          <MenuRadioGroup<T> value={value} onValueChange={(nextValue) => onChange?.(nextValue)}>
            {items.map((item) => (
              <MenuRadioItem<T>
                key={item.value}
                value={item.value}
                closeOnClick
                className="px-3 py-2 text-sm text-text-secondary"
              >
                <span className="grow truncate">{item.name}</span>
                <MenuRadioItemIndicator />
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </div>
  )
}
