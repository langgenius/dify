'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Option = {
  value: string
  text: string | JSX.Element
}

type ItemProps = {
  className?: string
  isActive: boolean
  onClick: (v: string) => void
  option: Option
}
const Item: FC<ItemProps> = ({
  className,
  isActive,
  onClick,
  option,
}) => {
  return (
    <div
      key={option.value}
      className={cn(
        'relative pb-2.5 system-xl-semibold',
        !isActive && 'cursor-pointer',
        className,
      )}
      onClick={() => !isActive && onClick(option.value)}
    >
      <div className={cn(isActive ? 'text-text-primary' : 'text-text-tertiary')}>{option.text}</div>
      {isActive && (
        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-util-colors-blue-blue-500'></div>
      )}
    </div>
  )
}

type Props = {
  className?: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  noBorderBottom?: boolean
  itemClassName?: string
}

const TabSlider: FC<Props> = ({
  className,
  value,
  onChange,
  options,
  noBorderBottom,
  itemClassName,
}) => {
  return (
    <div className={cn(className, !noBorderBottom && 'border-b border-divider-subtle', 'flex  space-x-6')}>
      {options.map(option => (
        <Item
          isActive={option.value === value}
          option={option}
          onClick={onChange}
          key={option.value}
          className={itemClassName}
        />
      ))}
    </div>
  )
}
export default React.memo(TabSlider)
