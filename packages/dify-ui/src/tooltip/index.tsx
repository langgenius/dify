'use client'

import type { Placement } from '../placement'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import * as React from 'react'
import { cn } from '../cn'
import { parsePlacement } from '../placement'

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
const TooltipProvider = BaseTooltip.Provider
const Tooltip = BaseTooltip.Root
const TooltipTrigger = BaseTooltip.Trigger

type TooltipProviderProps = BaseTooltip.Provider.Props
type TooltipProps<Payload = unknown> = BaseTooltip.Root.Props<Payload>
type TooltipTriggerProps<Payload = unknown> = BaseTooltip.Trigger.Props<Payload>

type TooltipContentProps = Omit<BaseTooltip.Popup.Props, 'children' | 'className'> &
  Pick<BaseTooltip.Positioner.Props, 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
    placement?: Placement
    className?: string
  }

function TooltipContent({
  children,
  placement = 'top',
  sideOffset = 8,
  alignOffset = 0,
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
        className="z-50 outline-hidden"
      >
        <BaseTooltip.Popup
          className={cn(
            'max-w-75 rounded-md bg-components-panel-bg px-3 py-2 text-start system-xs-regular wrap-break-word text-text-tertiary shadow-lg',
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

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

export type { TooltipContentProps, TooltipProps, TooltipProviderProps, TooltipTriggerProps }
