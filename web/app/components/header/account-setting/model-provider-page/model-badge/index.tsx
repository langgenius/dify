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
      'flex items-center px-1 h-[18px] rounded-[5px] border border-black/8 bg-white/[0.48] text-[10px] font-medium text-gray-500 cursor-default',
      className,
    )}>
      {children}
    </div>
  )
}

export default ModelBadge
