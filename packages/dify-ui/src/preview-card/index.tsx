'use client'

import type * as React from 'react'
import type { Placement } from '../placement'
import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import { cn } from '../cn'
import { floatingPopupAnimationClassName } from '../overlay-shared'
import { parsePlacement } from '../placement'

/**
 * PreviewCard follows Base UI's canonical semantics: a hover/focus-triggered
 * visual enhancement for a link that previews its destination.
 *
 * Contract:
 * - Prefer the canonical anchor trigger and keep the popup non-interactive.
 * - Do not place unique or essential information or actions in the popup unless
 *   they are also available at the linked destination.
 * - Touch and screen reader users cannot access the preview. Use Popover when
 *   opening the popup is itself the trigger's purpose or its content must be
 *   accessible across input modes.
 */
const PreviewCard = BasePreviewCard.Root
const PreviewCardTrigger = BasePreviewCard.Trigger
const PreviewCardViewport = BasePreviewCard.Viewport
const createPreviewCardHandle = BasePreviewCard.createHandle

type PreviewCardProps<Payload = unknown> = BasePreviewCard.Root.Props<Payload>
type PreviewCardHandle<Payload = unknown> = BasePreviewCard.Handle<Payload>
type PreviewCardTriggerProps<Payload = unknown> = BasePreviewCard.Trigger.Props<Payload>
type PreviewCardViewportProps = BasePreviewCard.Viewport.Props

type PreviewCardContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    BasePreviewCard.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<BasePreviewCard.Popup.Props, 'children' | 'className'>
}

function PreviewCardContent({
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
            floatingPopupAnimationClassName,
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

export {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
  PreviewCardViewport,
}
export type {
  PreviewCardContentProps,
  PreviewCardHandle,
  PreviewCardProps,
  PreviewCardTriggerProps,
  PreviewCardViewportProps,
}
