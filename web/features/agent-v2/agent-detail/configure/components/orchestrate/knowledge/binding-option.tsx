import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'

export function KnowledgeBindingOption({
  name,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  name: string
  description?: string | null
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()

  return (
    <div
      className={cn(
        'group/space flex h-14 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors motion-reduce:transition-none',
        checked
          ? 'bg-state-accent-active'
          : 'focus-within:bg-state-base-hover hover:bg-state-base-hover',
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-3',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg text-text-secondary shadow-xs group-focus-within/space:text-text-accent group-hover/space:text-text-accent"
        >
          <span className="i-ri-book-open-line size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            id={`${id}-name`}
            className={cn(
              'block truncate system-sm-medium',
              disabled
                ? 'text-text-tertiary'
                : 'text-text-secondary group-focus-within/space:text-text-primary group-hover/space:text-text-primary',
            )}
          >
            {name}
          </span>
          {!!description && (
            <span className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-150 group-focus-within/space:grid-rows-[1fr] group-focus-within/space:opacity-100 group-hover/space:grid-rows-[1fr] group-hover/space:opacity-100 motion-reduce:transition-none">
              <span
                id={`${id}-description`}
                className="min-h-0 truncate overflow-hidden system-xs-regular text-text-tertiary"
              >
                {description}
              </span>
            </span>
          )}
        </span>
        <Checkbox
          id={id}
          aria-labelledby={`${id}-name`}
          aria-describedby={description ? `${id}-description` : undefined}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </label>
    </div>
  )
}
