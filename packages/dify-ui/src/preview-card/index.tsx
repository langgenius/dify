'use client'

import type * as React from 'react'
import { PreviewCard as BasePreviewCard } from '@base-ui/react/preview-card'
import { cn } from '../cn'
import { floatingPopupAnimationClassName, positionerClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

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

type PreviewCardActions = BasePreviewCard.Root.Actions
type PreviewCardChangeEventReason = BasePreviewCard.Root.ChangeEventReason
type PreviewCardChangeEventDetails = BasePreviewCard.Root.ChangeEventDetails

type PreviewCardProps<Payload = unknown> = BasePreviewCard.Root.Props<Payload>
type PreviewCardHandle<Payload = unknown> = BasePreviewCard.Handle<Payload>
type PreviewCardTriggerProps<Payload = unknown> = BasePreviewCard.Trigger.Props<Payload>
type PreviewCardPortalProps = BasePreviewCard.Portal.Props
type PreviewCardViewportProps = BasePreviewCard.Viewport.Props

type PreviewCardPositionerProps = BasePreviewCard.Positioner.Props

function PreviewCardPositioner({
  className,
  sideOffset = 8,
  ...props
}: PreviewCardPositionerProps) {
  return (
    <BasePreviewCard.Positioner
      sideOffset={sideOffset}
      className={(state) => cn(positionerClassName, resolveClassName(className, state))}
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
  Pick<PreviewCardPositionerProps, 'alignOffset' | 'side' | 'align' | 'sideOffset'> & {
    children: React.ReactNode
  }

function PreviewCardContent({
  children,
  side,
  align,
  sideOffset,
  alignOffset,
  className,
  ...props
}: PreviewCardContentProps) {
  return (
    <PreviewCardPortal>
      <PreviewCardPositioner
        side={side}
        align={align}
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
  PreviewCardActions,
  PreviewCardChangeEventDetails,
  PreviewCardChangeEventReason,
  PreviewCardContentProps,
  PreviewCardHandle,
  PreviewCardPopupProps,
  PreviewCardPortalProps,
  PreviewCardPositionerProps,
  PreviewCardProps,
  PreviewCardTriggerProps,
  PreviewCardViewportProps,
}
