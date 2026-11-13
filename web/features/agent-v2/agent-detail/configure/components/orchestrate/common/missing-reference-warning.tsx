'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
          <IconButton
            aria-label={label}
            size="sm"
            className={cn('shrink-0 hover:bg-transparent', className)}
          >
            <span aria-hidden className="i-ri-alert-fill size-3.5 text-text-warning-secondary" />
          </IconButton>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
