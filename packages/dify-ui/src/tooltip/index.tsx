'use client'

import type * as React from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from '../cn'
import { hintPopupClassName, positionerClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

const TooltipProvider = BaseTooltip.Provider
const Tooltip = BaseTooltip.Root
const TooltipTrigger = BaseTooltip.Trigger

type TooltipProviderProps = BaseTooltip.Provider.Props
type TooltipActions = BaseTooltip.Root.Actions
type TooltipChangeEventReason = BaseTooltip.Root.ChangeEventReason
type TooltipChangeEventDetails = BaseTooltip.Root.ChangeEventDetails

type TooltipProps<Payload = unknown> = BaseTooltip.Root.Props<Payload>
type TooltipTriggerProps<Payload = unknown> = BaseTooltip.Trigger.Props<Payload>

type TooltipContentProps = Omit<BaseTooltip.Popup.Props, 'children'> &
  Pick<BaseTooltip.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
  }

function TooltipContent({
  children,
  side,
  align,
  sideOffset = 8,
  alignOffset,
  className,
  ...props
}: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={positionerClassName}
      >
        <BaseTooltip.Popup
          className={(state) => cn(hintPopupClassName, resolveClassName(className, state))}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

export type {
  TooltipActions,
  TooltipChangeEventDetails,
  TooltipChangeEventReason,
  TooltipContentProps,
  TooltipProps,
  TooltipProviderProps,
  TooltipTriggerProps,
}
