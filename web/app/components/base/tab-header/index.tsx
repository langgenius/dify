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
        'relative flex items-center pt-2.5 pb-2 border-b-2 border-transparent system-md-semibold cursor-pointer',
        id === value ? 'text-text-primary border-components-tab-active' : 'text-text-tertiary',
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
