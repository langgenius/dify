'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  title: string
  description: string
  isChosen: boolean
  onChosen: () => void
  chosenConfig?: React.ReactNode
  icon?: JSX.Element
}

const RadioCard: FC<Props> = ({
  title,
  description,
  isChosen,
  onChosen,
  icon,
}) => {
  return (
    <div
      className={cn(s.item, isChosen && s.active, 'flex')}
      onClick={onChosen}
    >
      {icon}
      <div>
        <div className='flex justify-between items-center'>
          <div className='leading-5 text-sm font-medium text-gray-900'>{title}</div>
          <div className={s.radio}></div>
        </div>
        <div className='leading-[18px] text-xs font-normal text-gray-500'>{description}</div>
      </div>
    </div>
  )
}
export default React.memo(RadioCard)
