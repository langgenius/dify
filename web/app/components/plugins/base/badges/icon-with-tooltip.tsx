import React, { type FC } from 'react'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
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
  const iconClassName = cn('w-5 h-5', className)
  const Icon = isDark ? BadgeIconDark : BadgeIconLight

  return (
    <Tooltip
      popupClassName='p-1.5 border-[0.5px] border-[0.5px] border-components-panel-border bg-components-tooltip-bg text-text-secondary system-xs-medium'
      popupContent={popupContent}
    >
      <div className='flex items-center justify-center shrink-0'>
        <Icon className={iconClassName} />
      </div>
    </Tooltip>
  )
}

export default React.memo(IconWithTooltip)
