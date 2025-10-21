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
      'system-2xs-medium-uppercase flex h-[18px] cursor-default items-center rounded-[5px] border border-divider-deep px-1 text-text-tertiary',
      className,
    )}>
      {children}
    </div>
  )
}

export default ModelBadge
