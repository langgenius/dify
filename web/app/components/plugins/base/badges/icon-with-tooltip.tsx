import type { FC } from 'react'
import type { ResolvedTheme } from '@/features/theme/theme'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'

type IconWithTooltipProps = {
  className?: string
  popupContent?: string
  theme: ResolvedTheme
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
  const isDark = theme === 'dark'
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
