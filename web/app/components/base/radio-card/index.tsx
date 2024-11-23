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
}) => {
  return (
    <div
      className={cn(
        'border border-components-option-card-option-border bg-components-option-card-option-bg rounded-xl hover:shadow-xs cursor-pointer',
        isChosen && 'bg-components-option-card-option-selected-bg border-components-panel-border shadow-xs',
      )}
    >
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
            <div className={cn(
              'w-4 h-4 border border-components-radio-border bg-components-radio-bg shadow-xs rounded-full',
              isChosen && 'border-[5px] border-components-radio-border-checked',
            )}></div>
          </div>
        )}
      </div>
      {((isChosen && chosenConfig) || noRadio) && (
        <div className={cn(chosenConfigWrapClassName, 'p-3 border-t border-gray-200')}>
          {chosenConfig}
        </div>
      )}
    </div>
  )
}
export default React.memo(RadioCard)
