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
        'border-components-option-card-option-border bg-components-option-card-option-bg relative cursor-pointer rounded-xl border-[0.5px] p-3',
        isChosen && 'bg-components-option-card-option-selected-bg border-[1.5px]',
        className,
      )}
    >
      <div className='flex gap-x-2' onClick={onChosen}>
        <div className={cn(iconBgClassName, 'flex size-8 shrink-0 items-center justify-center rounded-lg shadow-md')}>
          {icon}
        </div>
        <div className='grow'>
          <div className='system-sm-semibold text-text-secondary mb-1'>{title}</div>
          <div className='system-xs-regular text-text-tertiary'>{description}</div>
        </div>
        {!noRadio && (
          <div className='absolute right-3 top-3'>
            <div className={cn(
              'border-components-radio-border bg-components-radio-bg shadow-xs h-4 w-4 rounded-full border',
              isChosen && 'border-components-radio-border-checked border-[5px]',
            )}></div>
          </div>
        )}
      </div>
      {((isChosen && chosenConfig) || noRadio) && (
        <div className='mt-2 flex gap-x-2'>
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
