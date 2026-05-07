import type { FC } from 'react'
import {
  Tooltip as DifyTooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useState } from 'react'

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
  const [open, setOpen] = useState(false)

  return (
    <DifyTooltip
      open={open}
      onOpenChange={setOpen}
    >
      <TooltipTrigger
        render={(
          <div
            data-testid="tooltip-trigger-content"
            className="mr-6 flex items-center"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          />
        )}
      >
        {icon}
        {data}
      </TooltipTrigger>
      <TooltipContent
        data-testid="tooltip-popup"
        placement="top-start"
        sideOffset={0}
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
