import type { FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type ModelBadgeProps = {
  className?: string
  children?: ReactNode
}
const ModelBadge: FC<ModelBadgeProps> = ({ className, children }) => {
  return (
    <span
      className={cn(
        'inline-flex h-4.5 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary',
        className,
      )}
    >
      {children}
    </span>
  )
}

export default ModelBadge
