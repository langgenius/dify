'use client'

import type { FC } from 'react'
import type { AppIconType } from '@/types/app'
import data from '@emoji-mart/data'
import { cn } from '@langgenius/dify-ui/cn'
import { init } from 'emoji-mart'

init({ data })

type AnswerIconProps = {
  iconType?: AppIconType | null
  icon?: string | null
  background?: string | null
  imageUrl?: string | null
}

const AnswerIcon: FC<AnswerIconProps> = ({
  iconType,
  icon,
  background,
  imageUrl,
}) => {
  const wrapperClassName = cn('flex', 'items-center', 'justify-center', 'w-full', 'h-full', 'rounded-full', 'border-[0.5px]', 'border-black/5', 'text-xl')
  const isValidImageIcon = iconType === 'image' && imageUrl
  return (
    <div
      className={wrapperClassName}
      style={{ background: background || '#D5F5F6' }}
    >
      {isValidImageIcon
        ? <img src={imageUrl} className="h-full w-full rounded-full" alt="answer icon" />
        : (icon && icon !== '') ? <em-emoji id={icon} /> : <em-emoji id="🤖" />}
    </div>
  )
}

export default AnswerIcon
