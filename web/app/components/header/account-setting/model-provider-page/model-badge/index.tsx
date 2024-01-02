import type { FC, ReactNode } from 'react'

type ModelBadgeProps = {
  className?: string
  children?: ReactNode
}
const ModelBadge: FC<ModelBadgeProps> = ({
  className,
  children,
}) => {
  return (
    <div className={`
      flex items-center px-1 h-[18px] rounded-[5px] border border-black/[0.08] bg-white/[0.48]
      text-[10px] font-medium text-gray-500
      ${className}
    `}>
      {children}
    </div>
  )
}

export default ModelBadge
