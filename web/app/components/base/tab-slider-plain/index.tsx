'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'

type Option = {
  value: string
  text: string
}

type ItemProps = {
  isActive: boolean
  onClick: (v: string) => void
  option: Option
}
const Item: FC<ItemProps> = ({
  isActive,
  onClick,
  option,
}) => {
  return (
    <div
      key={option.value}
      className={cn(!isActive && 'cursor-pointer', 'relative pb-2.5  leading-6 text-base font-semibold')}
      onClick={() => !isActive && onClick(option.value)}
    >
      <div className={cn(isActive ? 'text-gray-900' : 'text-gray-600')}>{option.text}</div>
      {isActive && (
        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-[#155EEF]'></div>
      )}
    </div>
  )
}

type Props = {
  className?: string
  value: string
  onChange: (v: string) => void
  options: Option[]
}

const TabSlider: FC<Props> = ({
  className,
  value,
  onChange,
  options,
}) => {
  return (
    <div className={cn(className, 'flex border-b border-[#EAECF0] space-x-6')}>
      {options.map(option => (
        <Item
          isActive={option.value === value}
          option={option}
          onClick={onChange}
          key={option.value}
        />
      ))}
    </div>
  )
}
export default React.memo(TabSlider)
