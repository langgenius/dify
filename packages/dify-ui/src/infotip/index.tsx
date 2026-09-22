'use client'

import type * as React from 'react'
import type { Placement } from '../placement'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '../cn'
import { iconButtonVariants } from '../icon-button'
import { resolveClassName } from '../internals/resolve-class-name'
import { hintPopupClassName } from '../overlay-shared'
import { parsePlacement } from '../placement'

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
type InfotipProps<Payload = unknown> = BasePopover.Root.Props<Payload>

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
  Pick<BasePopover.Positioner.Props, 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
    placement?: Placement
  }

function InfotipContent({
  placement = 'top',
  sideOffset = 8,
  alignOffset = 0,
  className,
  ...props
}: InfotipContentProps) {
  const { side, align } = parsePlacement(placement)
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50 outline-hidden"
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

export { Infotip, InfotipContent, InfotipTrigger }
export type { InfotipContentProps, InfotipProps, InfotipTriggerProps }
