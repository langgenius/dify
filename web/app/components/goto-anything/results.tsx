import type { GotoAnythingOption } from './command-options'
import {
  AutocompleteCollection,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteItem,
  AutocompleteList,
} from '@langgenius/dify-ui/autocomplete'
import { cn } from '@langgenius/dify-ui/cn'
import { isCommandOption } from './command-options'

type OptionGroup<T> = {
  id: string
  label: string
  items: T[]
}

export type ResultListProps = {
  groups: OptionGroup<GotoAnythingOption>[]
  label: string
  onSelect: (option: GotoAnythingOption) => void
}

export function ResultList({ groups, label, onSelect }: ResultListProps) {
  return (
    <AutocompleteList aria-label={label} className="max-h-none overflow-visible p-0">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <AutocompleteGroup key={group.id} items={group.items}>
            <AutocompleteGroupLabel className="flex h-10 items-end px-4 pb-2 text-start text-xs font-medium text-text-tertiary">
              {group.label}
            </AutocompleteGroupLabel>
            <AutocompleteCollection<GotoAnythingOption>>
              {(option) => (
                <AutocompleteItem
                  key={
                    isCommandOption(option)
                      ? `${option.shortcut}:${option.result?.id ?? ''}`
                      : `${option.type}:${option.id}`
                  }
                  value={option}
                  className={cn(
                    'mx-2 gap-3 px-3 py-1 text-text-primary',
                    option.description ? 'min-h-12' : 'min-h-11 md:min-h-10',
                  )}
                  onClick={() => onSelect(option)}
                >
                  {isCommandOption(option) ? (
                    <span className="flex size-8 shrink-0 items-center justify-center text-text-tertiary">
                      <span aria-hidden className={cn(option.icon, 'size-5')} />
                    </span>
                  ) : (
                    option.icon
                  )}
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block truncate text-sm font-medium">{option.title}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-text-tertiary">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isCommandOption(option) && option.opensPage && (
                    <span
                      aria-hidden
                      className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary [&:dir(rtl)]:-scale-x-100"
                    />
                  )}
                </AutocompleteItem>
              )}
            </AutocompleteCollection>
          </AutocompleteGroup>
        ))}
    </AutocompleteList>
  )
}
