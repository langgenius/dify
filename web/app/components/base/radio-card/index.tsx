'use client'
import type { FC } from 'react'
import React from 'react'
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
  className,
}) => {
  return (
    <div
      className={cn(
        'relative p-3 border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg rounded-xl cursor-pointer',
        isChosen && 'border-[1.5px] bg-components-option-card-option-selected-bg',
        className,
      )}
    >
      <div className='flex gap-x-2' onClick={onChosen}>
        <div className={cn(iconBgClassName, 'shrink-0 flex size-8 justify-center items-center rounded-lg shadow-md')}>
          {icon}
        </div>
        <div className='grow'>
          <div className='system-sm-semibold text-text-secondary mb-1'>{title}</div>
          <div className='system-xs-regular text-text-tertiary'>{description}</div>
        </div>
        {!noRadio && (
          <div className='absolute top-3 right-3'>
            <div className={cn(
              'w-4 h-4 border border-components-radio-border bg-components-radio-bg shadow-xs rounded-full',
              isChosen && 'border-[5px] border-components-radio-border-checked',
            )}></div>
          </div>
        )}
      </div>
      {((isChosen && chosenConfig) || noRadio) && (
        <div className='flex gap-x-2 mt-2'>
          <div className='size-8 shrink-0'></div>
          <div className={cn(chosenConfigWrapClassName, 'grow')}>
            {chosenConfig}
          </div>
        </div>
      )}
    </div>
  )
}
export default React.memo(RadioCard)
