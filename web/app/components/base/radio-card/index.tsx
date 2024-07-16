'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  icon: React.ReactNode
  iconBgClassName?: string
  title: React.ReactNode
  description: string
  noRadio?: boolean
  isChosen?: boolean
  onChosen?: () => void
  chosenConfig?: React.ReactNode
  chosenConfigWrapClassName?: string
}

const RadioCard: FC<Props> = ({
  icon,
  iconBgClassName = 'bg-[#F5F3FF]',
  title,
  description,
  noRadio,
  isChosen,
  onChosen = () => { },
  chosenConfig,
  chosenConfigWrapClassName,
}) => {
  return (
    <div className={cn(s.item, isChosen && s.active)}>
      <div className='flex py-3 pl-3 pr-4' onClick={onChosen}>
        <div className={cn(iconBgClassName, 'mr-3 shrink-0 flex w-8 justify-center h-8 items-center rounded-lg')}>
          {icon}
        </div>
        <div className='grow'>
          <div className='leading-5 text-sm font-medium text-gray-900'>{title}</div>
          <div className='leading-[18px] text-xs font-normal text-[#667085]'>{description}</div>
        </div>
        {!noRadio && (
          <div className='shrink-0 flex items-center h-8'>
            <div className={s.radio}></div>
          </div>
        )}
      </div>
      {((isChosen && chosenConfig) || noRadio) && (
        <div className={cn(chosenConfigWrapClassName, 'pt-2 px-14 pb-6 border-t border-gray-200')}>
          {chosenConfig}
        </div>
      )}
    </div>
  )
}
export default React.memo(RadioCard)
