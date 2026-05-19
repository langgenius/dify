import type { FC } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import * as React from 'react'

type CitationTooltipProps = {
  data: number | string
  text: string
  icon: React.ReactNode
}

const CitationTooltip: FC<CitationTooltipProps> = ({
  data,
  text,
  icon,
}) => {
  return (
    <Tooltip>
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
    </Tooltip>
  )
}

export default CitationTooltip
