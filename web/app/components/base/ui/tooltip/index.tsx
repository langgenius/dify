'use client'

import type { Placement } from '@floating-ui/react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export type TooltipProps = {
  position?: Placement
  disabled?: boolean
  popupContent?: React.ReactNode
  children?: React.ReactNode
  popupClassName?: string
  noDecoration?: boolean
  offset?: number
}

const Tooltip = React.memo(({
  position = 'top',
  disabled = false,
  popupContent,
  children,
  popupClassName,
  noDecoration,
  offset = 8,
}: TooltipProps) => {
  const { side, align } = parsePlacement(position)

  if (!popupContent || disabled)
    return <>{children}</>

  return (
    <BaseTooltip.Root>
      {React.isValidElement(children)
        ? <BaseTooltip.Trigger render={children} />
        : <BaseTooltip.Trigger render={<span className="inline-flex" />}>{children}</BaseTooltip.Trigger>}
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={offset}
          className="z-tooltip outline-none"
        >
          <BaseTooltip.Popup
            className={cn(
              !noDecoration && 'max-w-[300px] break-words rounded-md bg-components-panel-bg px-3 py-2 text-left text-text-tertiary shadow-lg system-xs-regular',
              popupClassName,
            )}
          >
            {popupContent}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
})

Tooltip.displayName = 'Tooltip'

export const TooltipProvider = BaseTooltip.Provider
export default Tooltip
