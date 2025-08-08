'use client'

import type { FC } from 'react'
import { init } from 'emoji-mart'
import data from '@emoji-mart/data'
import classNames from '@/utils/classnames'
import type { AppIconType } from '@/types/app'
import { matchCond } from '@/utils/var'

init({ data })

export type AnswerIconProps = {
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
  const wrapperClassName = classNames(
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
  return <div
    className={wrapperClassName}
    style={{ background: background || '#D5F5F6' }}
  >
    {
      matchCond(
        isValidImageIcon,
        [
          [true, <img src={imageUrl || ''} className="h-full w-full rounded-full" alt="answer icon" />],
        ],
        (icon && icon !== '') ? <em-emoji id={icon} /> : <em-emoji id='🤖' />,
      )
    }
  </div>
}

export default AnswerIcon
