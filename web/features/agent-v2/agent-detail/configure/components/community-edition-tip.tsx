'use client'

import type { PopoverContentProps } from '@langgenius/dify-ui/popover'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

type CommunityEditionTipProps = Pick<PopoverContentProps, 'className' | 'placement'> & {
  tip: string
}

/**
 * Warning affordance for caveats that only apply to community edition.
 * Renders nothing on enterprise or cloud deployments, so callers do not repeat
 * the edition check.
 */
export function CommunityEditionTip({
  tip,
  placement = 'bottom',
  className,
}: CommunityEditionTipProps) {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })

  if (deploymentEdition !== 'COMMUNITY') return null

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
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
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
        className={cn('px-3 py-2 system-xs-regular text-text-tertiary', className)}
      >
        {tip}
      </PopoverContent>
    </Popover>
  )
}
