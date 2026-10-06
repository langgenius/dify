import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { Theme } from '@/types/app'

type IconWithTooltipProps = {
  className?: string
  popupContent?: string
  theme: Theme
  lightIconClassName: string
  darkIconClassName: string
}

const IconWithTooltip: FC<IconWithTooltipProps> = ({
  className,
  theme,
  popupContent,
  lightIconClassName,
  darkIconClassName,
}) => {
  const isDark = theme === Theme.dark
  const iconClassName = cn(isDark ? darkIconClassName : lightIconClassName, 'size-5', className)
  const icon = (
    <span className="flex shrink-0 items-center justify-center">
      <span aria-hidden className={iconClassName} />
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
