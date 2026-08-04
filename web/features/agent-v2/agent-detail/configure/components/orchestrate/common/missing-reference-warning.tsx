'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'

export function MissingReferenceWarning({
  className,
  label,
}: {
  className?: string
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              className,
            )}
          >
            <span aria-hidden className="i-ri-alert-fill size-3.5 text-text-warning-secondary" />
          </button>
        }
      />
      <TooltipContent aria-label={label}>{label}</TooltipContent>
    </Tooltip>
  )
}
