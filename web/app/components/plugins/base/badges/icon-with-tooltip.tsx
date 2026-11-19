import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'

type IconWithTooltipProps = {
  className?: string
  popupContent?: string
  lightIconClassName: string
  darkIconClassName: string
}

const IconWithTooltip: FC<IconWithTooltipProps> = ({
  className,
  popupContent,
  lightIconClassName,
  darkIconClassName,
}) => {
  const icon = (
    <span className="flex shrink-0 items-center justify-center">
      <span aria-hidden className={cn(lightIconClassName, 'size-5 dark:hidden', className)} />
      <span aria-hidden className={cn(darkIconClassName, 'size-5 not-dark:hidden', className)} />
      {popupContent && <span className="sr-only">{popupContent}</span>}
    </span>
  )

  if (!popupContent) return icon

  return (
    <Tooltip>
      <TooltipTrigger render={icon} />
      <TooltipContent>{popupContent}</TooltipContent>
    </Tooltip>
  )
}

export default React.memo(IconWithTooltip)
