'use client'

import type * as React from 'react'
import type { Placement } from '../placement'
import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
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
const PreviewCardPortal = BasePreviewCard.Portal
const PreviewCardTrigger = BasePreviewCard.Trigger
const PreviewCardViewport = BasePreviewCard.Viewport
const createPreviewCardHandle = BasePreviewCard.createHandle

type PreviewCardProps<Payload = unknown> = BasePreviewCard.Root.Props<Payload>
type PreviewCardHandle<Payload = unknown> = BasePreviewCard.Handle<Payload>
type PreviewCardTriggerProps<Payload = unknown> = BasePreviewCard.Trigger.Props<Payload>
type PreviewCardPortalProps = BasePreviewCard.Portal.Props
type PreviewCardViewportProps = BasePreviewCard.Viewport.Props

type PreviewCardPositionerProps = Omit<BasePreviewCard.Positioner.Props, 'side' | 'align'> & {
  placement?: Placement
}

function PreviewCardPositioner({
  className,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  ...props
}: PreviewCardPositionerProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BasePreviewCard.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      className={(state) => cn('z-50 outline-hidden', resolveClassName(className, state))}
      {...props}
    />
  )
}

type PreviewCardPopupProps = BasePreviewCard.Popup.Props

function PreviewCardPopup({ className, ...props }: PreviewCardPopupProps) {
  return (
    <BasePreviewCard.Popup
      className={(state) => cn(floatingPopupAnimationClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type PreviewCardContentProps = Omit<PreviewCardPopupProps, 'children'> &
  Pick<PreviewCardPositionerProps, 'alignOffset' | 'placement' | 'sideOffset'> & {
    children: React.ReactNode
  }

function PreviewCardContent({
  children,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  className,
  ...props
}: PreviewCardContentProps) {
  return (
    <PreviewCardPortal>
      <PreviewCardPositioner
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <PreviewCardPopup
          className={(state) =>
            cn(
              'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
              resolveClassName(className, state),
            )
          }
          {...props}
        >
          {children}
        </PreviewCardPopup>
      </PreviewCardPositioner>
    </PreviewCardPortal>
  )
}

export {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardPopup,
  PreviewCardPortal,
  PreviewCardPositioner,
  PreviewCardTrigger,
  PreviewCardViewport,
}
export type {
  PreviewCardContentProps,
  PreviewCardHandle,
  PreviewCardPopupProps,
  PreviewCardPortalProps,
  PreviewCardPositionerProps,
  PreviewCardProps,
  PreviewCardTriggerProps,
  PreviewCardViewportProps,
}
