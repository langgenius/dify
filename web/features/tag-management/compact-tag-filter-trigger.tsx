import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useEffect, useRef } from 'react'

type CompactTagFilterTriggerProps = {
  selectedLabels: string[]
  selectedCount: number
  label: string
  clearLabel: string
  onClear: () => void
}

export function CompactTagFilterTrigger({
  selectedLabels,
  selectedCount,
  label,
  clearLabel,
  onClear,
}: CompactTagFilterTriggerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreFocusRef = useRef(false)

  useEffect(() => {
    if (selectedCount || !shouldRestoreFocusRef.current) return

    shouldRestoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [selectedCount])

  return (
    <div className="relative inline-flex h-7 max-w-32 shrink-0 items-center">
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="small"
            aria-label={label}
            className={cn(
              'h-7 max-w-32 justify-start text-text-tertiary focus-visible:ring-inset',
              !selectedCount && 'size-7 min-h-0 justify-center p-0',
              !!selectedCount &&
                'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg py-0.5 ps-1 pe-7 shadow-xs shadow-shadow-shadow-3',
              !selectedCount && 'data-popup-open:bg-state-base-hover',
            )}
          >
            <span className={cn('shrink-0', !!selectedCount && 'py-0.5 ps-0.5')}>
              <span
                aria-hidden
                className={cn(
                  'i-ri-price-tag-3-line block size-4',
                  !!selectedCount && 'text-text-secondary',
                )}
              />
            </span>
            {!!selectedCount && (
              <span className="flex min-w-0 items-center gap-x-0.5 py-1 system-sm-medium">
                <span className="truncate text-text-secondary">
                  {selectedLabels.slice(0, 2).join(',') || label}
                </span>
                {selectedCount > 2 && (
                  <span className="shrink-0 system-xs-medium text-text-tertiary">
                    +{selectedCount - 2}
                  </span>
                )}
              </span>
            )}
          </Button>
        }
      />
      {!!selectedCount && (
        <IconButton
          variant="ghost"
          size="md"
          aria-label={clearLabel}
          className="absolute inset-e-0.5 focus-visible:ring-inset"
          onClick={() => {
            shouldRestoreFocusRef.current = true
            onClear()
          }}
        >
          <span aria-hidden className="i-ri-close-circle-fill size-4 text-text-quaternary" />
        </IconButton>
      )}
    </div>
  )
}
