'use client'
import React, { FC } from 'react'
import cn from 'classnames'

import s from './style.module.css'

export interface ITabHeaderProps {
  items: {
    id: string
    name: string
    extra?: React.ReactNode
  }[]
  value: string
  onChange: (value: string) => void
}

const TabHeader: FC<ITabHeaderProps> = ({
  items,
  value,
  onChange
}) => {
  return (
    <div className='flex space-x-4 border-b border-gray-200 '>
      {items.map(({ id, name, extra }) => (
        <div
          key={id}
          className={cn(id === value ? `${s.itemActive} text-gray-900` : 'text-gray-500', 'relative flex items-center pb-1.5 leading-6 cursor-pointer')}
          onClick={() => onChange(id)}
        >
          <div className='text-base font-semibold'>{name}</div>
          {extra ? extra : ''}
        </div>
      ))}
    </div>
  )
}
export default React.memo(TabHeader)
