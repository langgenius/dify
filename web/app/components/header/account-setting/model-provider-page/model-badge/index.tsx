import type { FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type ModelBadgeProps = {
  className?: string
  children?: ReactNode
}
const ModelBadge: FC<ModelBadgeProps> = ({
  className,
  children,
}) => {
  return (
    <div className={cn('inline-flex h-[18px] shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary', className)}>
      {children}
    </div>
  )
}

export default ModelBadge
