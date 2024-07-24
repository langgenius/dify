import { memo } from 'react'
import cn from '@/utils/classnames'

type BadgeProps = {
  className?: string
  text: string
}

const Badge = ({
  className,
  text,
}: BadgeProps) => {
  return (
    <div
      className={cn(
        'inline-flex items-center px-[5px] h-5 rounded-[5px] border border-divider-deep system-2xs-medium-uppercase leading-3 text-text-tertiary',
        className,
      )}
    >
      {text}
    </div>
  )
}

export default memo(Badge)
