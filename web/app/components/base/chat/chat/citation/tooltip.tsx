import type { FC } from 'react'
import {
  Tooltip as DifyTooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import * as React from 'react'

type TooltipProps = {
  data: number | string
  text: string
  icon: React.ReactNode
}

const Tooltip: FC<TooltipProps> = ({
  data,
  text,
  icon,
}) => {
  return (
    <DifyTooltip>
      <TooltipTrigger
        data-testid="tooltip-trigger-content"
        className="mr-6 flex items-center border-0 bg-transparent p-0 text-left"
      >
        {icon}
        {data}
      </TooltipTrigger>
      <TooltipContent
        data-testid="tooltip-popup"
        placement="top-start"
        className="rounded-lg bg-components-tooltip-bg p-3 system-xs-medium text-text-quaternary shadow-lg"
      >
        {text}
        {' '}
        {data}
      </TooltipContent>
    </DifyTooltip>
  )
}

export default Tooltip
