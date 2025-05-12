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
}

export type ITabHeaderProps = {
  items: Item[]
  value: string
  onChange: (value: string) => void
}

const TabHeader: FC<ITabHeaderProps> = ({
  items,
  value,
  onChange,
}) => {
  const renderItem = ({ id, name, icon, extra }: Item) => (
    <div
      key={id}
      className={cn(
        'system-md-semibold relative flex cursor-pointer items-center border-b-2 border-transparent pb-2 pt-2.5',
        id === value ? 'border-components-tab-active text-text-primary' : 'text-text-tertiary',
      )}
      onClick={() => onChange(id)}
    >
      {icon || ''}
      <div className='ml-2'>{name}</div>
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
