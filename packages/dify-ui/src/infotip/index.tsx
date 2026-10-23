'use client'

import type * as React from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '../cn'
import { iconButtonVariants } from '../icon-button'
import { hintPopupClassName, positionerClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

const iconClassNames = {
  question: 'i-ri-question-line',
  information: 'i-ri-information-line',
  warning: 'i-ri-error-warning-line',
} as const

const iconSizeClassNames = {
  small: 'size-3',
  medium: 'size-3.5',
  large: 'size-4',
} as const

const Infotip = BasePopover.Root
const InfotipTitle = BasePopover.Title
type InfotipActions = BasePopover.Root.Actions
type InfotipChangeEventReason = BasePopover.Root.ChangeEventReason
type InfotipChangeEventDetails = BasePopover.Root.ChangeEventDetails

type InfotipProps<Payload = unknown> = BasePopover.Root.Props<Payload>
type InfotipTitleProps = BasePopover.Title.Props

type InfotipTriggerProps<Payload = unknown> = Omit<
  BasePopover.Trigger.Props<Payload>,
  'children' | 'render' | 'nativeButton' | 'aria-label' | 'aria-labelledby'
> &
  (
    | { 'aria-label': string; 'aria-labelledby'?: never }
    | { 'aria-label'?: never; 'aria-labelledby': string }
  ) & {
    iconVariant?: keyof typeof iconClassNames
    iconSize?: keyof typeof iconSizeClassNames
  }

function InfotipTrigger<Payload = unknown>({
  className,
  iconVariant = 'question',
  iconSize = 'medium',
  openOnHover = true,
  delay = 300,
  closeDelay = 200,
  onClick,
  ...props
}: InfotipTriggerProps<Payload>) {
  return (
    <BasePopover.Trigger
      {...props}
      openOnHover={openOnHover}
      delay={delay}
      closeDelay={closeDelay}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(event)
      }}
      className={(state) =>
        cn(
          iconButtonVariants({ variant: null, size: 'xs' }),
          'shrink-0 border-0 bg-transparent text-text-quaternary outline-hidden hover:text-text-tertiary',
          resolveClassName(className, state),
        )
      }
    >
      <span aria-hidden className={cn(iconClassNames[iconVariant], iconSizeClassNames[iconSize])} />
    </BasePopover.Trigger>
  )
}

type InfotipContentProps = Omit<BasePopover.Popup.Props, 'children'> &
  Pick<BasePopover.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
  }

function InfotipContent({
  side = 'top',
  align = 'center',
  sideOffset = 8,
  alignOffset = 0,
  className,
  ...props
}: InfotipContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={positionerClassName}
      >
        <BasePopover.Popup
          {...props}
          className={(state) =>
            cn(hintPopupClassName, 'outline-hidden', resolveClassName(className, state))
          }
        />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

export { Infotip, InfotipContent, InfotipTitle, InfotipTrigger }
export type {
  InfotipActions,
  InfotipChangeEventDetails,
  InfotipChangeEventReason,
  InfotipContentProps,
  InfotipProps,
  InfotipTitleProps,
  InfotipTriggerProps,
}
