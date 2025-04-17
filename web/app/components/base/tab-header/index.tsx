'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Item = {
  id: string
  name: string
  isRight?: boolean
  icon?: React.ReactNode
  extra?: React.ReactNode
  disabled?: boolean
}

export type ITabHeaderProps = {
  items: Item[]
  value: string
  itemClassName?: string
  onChange: (value: string) => void
}

const TabHeader: FC<ITabHeaderProps> = ({
  items,
  value,
  itemClassName,
  onChange,
}) => {
  const renderItem = ({ id, name, icon, extra, disabled }: Item) => (
    <div
      key={id}
      className={cn(
        'system-md-semibold relative flex cursor-pointer items-center border-b-2 border-transparent pb-2 pt-2.5',
        id === value ? 'border-components-tab-active text-text-primary' : 'text-text-tertiary',
        disabled && 'cursor-not-allowed opacity-30',
      )}
      onClick={() => !disabled && onChange(id)}
    >
      {icon || ''}
      <div className={cn('ml-2', itemClassName)}>{name}</div>
      {extra || ''}
    </div>
  )
  return (
    <div className='flex justify-between'>
      <div className='flex space-x-4'>
        {items.filter(item => !item.isRight).map(renderItem)}
      </div>
      <div className='flex space-x-4'>
        {items.filter(item => item.isRight).map(renderItem)}
      </div>
    </div>
  )
}
export default React.memo(TabHeader)
