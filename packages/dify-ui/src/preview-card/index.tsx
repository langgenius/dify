'use client'

import type { ReactNode } from 'react'
import type { Placement } from '../placement'
import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import { cn } from '../cn'
import { parsePlacement } from '../placement'

export type { Placement }

/**
 * PreviewCard is a hover/focus-triggered rich preview intended to supplement a
 * trigger whose primary action is its own click destination (e.g. a link, a
 * selectable row, a chip that jumps to a definition).
 *
 * A11y contract — match Base UI's guidance:
 * - The popup MUST NOT contain information or actions that are not also
 *   reachable from the trigger's primary click destination. Touch and screen
 *   reader users cannot open the card and must be able to get the same
 *   information/actions without it.
 * - If content is unique to the popup, either (a) add a separate click-triggered
 *   affordance (Popover) next to the trigger, or (b) move the unique content
 *   onto the click destination.
 */
export const PreviewCard = BasePreviewCard.Root
export const PreviewCardTrigger = BasePreviewCard.Trigger
export const createPreviewCardHandle = BasePreviewCard.createHandle

type PreviewCardContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    BasePreviewCard.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    BasePreviewCard.Popup.Props,
    'children' | 'className'
  >
}

export function PreviewCardContent({
  children,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: PreviewCardContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BasePreviewCard.Portal>
      <BasePreviewCard.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <BasePreviewCard.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'origin-(--transform-origin) transition-[transform,scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none',
            popupClassName,
          )}
          {...popupProps}
        >
          {children}
        </BasePreviewCard.Popup>
      </BasePreviewCard.Positioner>
    </BasePreviewCard.Portal>
  )
}
