'use client'

import type { FC } from 'react'
import type { AppIconType } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { resolveEmoji } from '@/utils/emoji'

type AnswerIconProps = {
  iconType?: AppIconType | null
  icon?: string | null
  background?: string | null
  imageUrl?: string | null
}

const AnswerIcon: FC<AnswerIconProps> = ({ iconType, icon, background, imageUrl }) => {
  const wrapperClassName = cn(
    'flex',
    'items-center',
    'justify-center',
    'w-full',
    'h-full',
    'rounded-full',
    'border-[0.5px]',
    'border-black/5',
    'text-xl',
  )
  const isValidImageIcon = iconType === 'image' && imageUrl
  return (
    <div className={wrapperClassName} style={{ background: background || '#D5F5F6' }}>
      {isValidImageIcon ? (
        <img src={imageUrl} className="size-full rounded-full" alt="answer icon" />
      ) : (
        resolveEmoji(icon)
      )}
    </div>
  )
}

export default AnswerIcon
