import type { FC, ReactNode } from 'react'
import classNames from '@/utils/classnames'

type ModelBadgeProps = {
  className?: string
  children?: ReactNode
}
const ModelBadge: FC<ModelBadgeProps> = ({
  className,
  children,
}) => {
  return (
    <div className={classNames(
      'flex items-center px-1 h-[18px] rounded-[5px] border border-divider-deep system-2xs-medium-uppercase text-text-tertiary cursor-default',
      className,
    )}>
      {children}
    </div>
  )
}

export default ModelBadge
