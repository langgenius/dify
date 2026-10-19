import type { CommandOption, GotoAnythingOption } from './command-options'
import {
  AutocompleteCollection,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteRow,
} from '@langgenius/dify-ui/autocomplete'
import { cn } from '@langgenius/dify-ui/cn'
import { isCommandOption } from './command-options'

type OptionGroup<T> = {
  id: string
  label: string
  items: T[]
}

export function CommandGrid({
  groups,
  label,
  onSelect,
}: {
  groups: OptionGroup<CommandOption>[]
  label: string
  onSelect: (option: GotoAnythingOption) => void
}) {
  return (
    <AutocompleteList aria-label={label} className="max-h-none overflow-visible p-0">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <AutocompleteGroup key={group.id} items={group.items}>
            <AutocompleteGroupLabel className="flex h-10 items-end px-4 pb-2 text-start font-mono text-[11px] font-medium tracking-[0.12em] text-text-tertiary uppercase">
              {group.label}
            </AutocompleteGroupLabel>
            <div className="flex flex-col gap-1 px-4 pb-3">
              {Array.from({ length: Math.ceil(group.items.length / 2) }, (_, rowIndex) => {
                const row = group.items.slice(rowIndex * 2, rowIndex * 2 + 2)
                return (
                  <AutocompleteRow key={row[0]!.shortcut} className="grid grid-cols-2 gap-2">
                    {row.map((option) => (
                      <AutocompleteItem
                        key={option.shortcut}
                        value={option}
                        className="group m-0 min-h-18 items-start gap-2 rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg/90 p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-sm data-highlighted:border-state-accent-solid/30 data-highlighted:bg-state-accent-hover sm:gap-3 sm:p-3"
                        onClick={() => onSelect(option)}
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default text-text-tertiary group-data-highlighted:text-text-accent sm:size-8">
                          <span aria-hidden className={cn(option.icon, 'size-4')} />
                        </span>
                        <span className="min-w-0 flex-1 text-start">
                          <span className="block font-mono text-xs font-semibold tracking-[-0.01em] wrap-break-word text-text-primary">
                            {option.shortcut}
                          </span>
                          <span className="mt-1 block text-xs leading-4 wrap-break-word text-text-tertiary">
                            {option.shortcut.startsWith('@')
                              ? (option.description ?? option.title)
                              : option.title}
                          </span>
                        </span>
                      </AutocompleteItem>
                    ))}
                  </AutocompleteRow>
                )
              })}
            </div>
          </AutocompleteGroup>
        ))}
    </AutocompleteList>
  )
}

export function ResultList({
  groups,
  label,
  onSelect,
}: {
  groups: OptionGroup<GotoAnythingOption>[]
  label: string
  onSelect: (option: GotoAnythingOption) => void
}) {
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
                  className="group mx-2 min-h-12 gap-3 px-3 py-2 text-text-primary"
                  onClick={() => onSelect(option)}
                >
                  {isCommandOption(option) ? (
                    <span className="flex size-8 shrink-0 items-center justify-center text-text-tertiary group-data-highlighted:text-text-accent">
                      <span aria-hidden className={cn(option.icon, 'size-5')} />
                    </span>
                  ) : (
                    option.icon
                  )}
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block text-sm font-medium">{option.title}</span>
                    {option.description && (
                      <span className="block text-xs text-text-tertiary">{option.description}</span>
                    )}
                  </span>
                  {isCommandOption(option) && (
                    <span className="shrink-0 font-mono text-xs text-text-tertiary">
                      {option.shortcut}
                    </span>
                  )}
                </AutocompleteItem>
              )}
            </AutocompleteCollection>
          </AutocompleteGroup>
        ))}
    </AutocompleteList>
  )
}
