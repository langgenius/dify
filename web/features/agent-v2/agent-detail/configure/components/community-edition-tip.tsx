'use client'

import type { Placement } from '@langgenius/dify-ui/popover'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

type CommunityEditionTipProps = {
  tip: string
  placement?: Placement
  popupClassName?: string
}

/**
 * Warning affordance for caveats that only apply to community edition.
 * Renders nothing on an enterprise deployment, so callers do not repeat the
 * edition check.
 */
export function CommunityEditionTip({
  tip,
  placement = 'bottom',
  popupClassName,
}: CommunityEditionTipProps) {
  const { data: isEnterprise } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.enterprise_enabled,
  })

  if (isEnterprise) return null

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        aria-label={tip}
        render={
          <button
            type="button"
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span
              aria-hidden
              className="i-custom-vender-line-alertsAndFeedback-alert-triangle size-4 text-text-warning-secondary"
            />
          </button>
        }
      />
      <PopoverContent
        placement={placement}
        popupClassName={cn('px-3 py-2 system-xs-regular text-text-tertiary', popupClassName)}
      >
        {tip}
      </PopoverContent>
    </Popover>
  )
}
