import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { Theme } from '@/types/app'

type IconWithTooltipProps = {
  className?: string
  popupContent?: string
  theme: Theme
  BadgeIconLight: React.ElementType
  BadgeIconDark: React.ElementType
}

const IconWithTooltip: FC<IconWithTooltipProps> = ({
  className,
  theme,
  popupContent,
  BadgeIconLight,
  BadgeIconDark,
}) => {
  const isDark = theme === Theme.dark
  const iconClassName = cn('h-5 w-5', className)
  const Icon = isDark ? BadgeIconDark : BadgeIconLight
  const icon = (
    <span
      aria-label={popupContent}
      className="flex shrink-0 items-center justify-center"
    >
      <Icon className={iconClassName} />
    </span>
  )

  if (!popupContent)
    return icon

  return (
    <Tooltip>
      <TooltipTrigger render={icon} />
      <TooltipContent className="border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 system-xs-medium text-text-secondary">
        {popupContent}
      </TooltipContent>
    </Tooltip>
  )
}

export default React.memo(IconWithTooltip)
