'use client'

import type { ReactNode } from 'react'
import type { Placement } from '../placement'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from '../cn'
import { parsePlacement } from '../placement'

export type { Placement }

/**
 * Tooltip is an **ephemeral hint** tied to a trigger (typically an icon button,
 * badge, or short label). It follows Base UI's Tooltip semantics:
 *
 * - Opens on pointer hover or keyboard focus on the trigger.
 * - Closes as soon as the pointer leaves the trigger — the popup itself is
 *   **not dwell-able**; users cannot move their cursor onto the tooltip.
 * - Must contain only short, non-interactive text. No links, buttons, form
 *   controls, or structured panels.
 *
 * If you need any of the following, use `PreviewCard` instead (hover-triggered
 * rich preview that users can move their cursor onto):
 *
 * - Multi-line or structured content (icon + title + metadata)
 * - Content the user needs to "stop and read" for more than ~1 second
 * - Content wider than ~300px
 *
 * If you need interactive affordances (buttons, links, forms) use `Popover`.
 */
export const TooltipProvider = BaseTooltip.Provider
export const Tooltip = BaseTooltip.Root
export const TooltipTrigger = BaseTooltip.Trigger

type TooltipContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  positionerClassName?: string
  className?: string
} & Omit<BaseTooltip.Popup.Props, 'children' | 'className'>

export function TooltipContent({
  children,
  placement = 'top',
  sideOffset = 8,
  alignOffset = 0,
  positionerClassName,
  className,
  ...props
}: TooltipContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-hidden', positionerClassName)}
      >
        <BaseTooltip.Popup
          className={cn(
            'max-w-[300px] rounded-md bg-components-panel-bg px-3 py-2 text-left system-xs-regular wrap-break-word text-text-tertiary shadow-lg',
            'origin-(--transform-origin) transition-opacity data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0 motion-reduce:transition-none',
            className,
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}
