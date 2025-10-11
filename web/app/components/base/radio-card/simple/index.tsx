'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  title: string | React.JSX.Element | null
  description: string
  isChosen: boolean
  onChosen: () => void
  chosenConfig?: React.ReactNode
  icon?: React.JSX.Element
  extra?: React.ReactNode
}

const RadioCard: FC<Props> = ({
  title,
  description,
  isChosen,
  onChosen,
  icon,
  extra,
}) => {
  return (
    <div
      className={cn(s.item, isChosen && s.active)}
      onClick={onChosen}
    >
      <div className='flex px-3 py-2'>
        {icon}
        <div>
          <div className='flex items-center justify-between'>
            <div className='text-sm font-medium leading-5 text-gray-900'>{title}</div>
            <div className={s.radio}></div>
          </div>
          <div className='text-xs font-normal leading-[18px] text-gray-500'>{description}</div>
        </div>
      </div>
      {extra}
    </div>
  )
}
export default React.memo(RadioCard)
