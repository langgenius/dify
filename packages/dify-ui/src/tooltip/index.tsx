'use client'

import type * as React from 'react'
import type { Placement } from '../placement'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
import { hintPopupClassName } from '../overlay-shared'
import { parsePlacement } from '../placement'

const TooltipProvider = BaseTooltip.Provider
const Tooltip = BaseTooltip.Root
const TooltipTrigger = BaseTooltip.Trigger

type TooltipProviderProps = BaseTooltip.Provider.Props
type TooltipProps<Payload = unknown> = BaseTooltip.Root.Props<Payload>
type TooltipTriggerProps<Payload = unknown> = BaseTooltip.Trigger.Props<Payload>

type TooltipContentProps = Omit<BaseTooltip.Popup.Props, 'children'> &
  Pick<BaseTooltip.Positioner.Props, 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
    placement?: Placement
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

export type { TooltipContentProps, TooltipProps, TooltipProviderProps, TooltipTriggerProps }
