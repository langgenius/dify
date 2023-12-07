import type { FC } from 'react'

type ModelBadgeProps = {
  text: string
}
const ModelBadge: FC<ModelBadgeProps> = ({
  text,
}) => {
  return (
    <div className={`
      flex items-center px-1 h-[18px] rounded-[5px] border border-black/[0.08] bg-white/[0.48]
      text-[10px] font-medium text-gray-500
    `}>
      {text}
    </div>
  )
}

export default ModelBadge
