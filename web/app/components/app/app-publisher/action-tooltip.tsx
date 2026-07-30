import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'

type ActionTooltipProps = {
  children: ReactNode
  disabled: boolean
  tooltip?: ReactNode
}

const ActionTooltip = ({ children, disabled, tooltip }: ActionTooltipProps) => {
  if (!tooltip) return <>{children}</>

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn('flex w-full', disabled && 'cursor-not-allowed *:pointer-events-none')}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export default ActionTooltip
