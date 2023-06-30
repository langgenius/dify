'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'

import s from './style.module.css'

type Item = {
  id: string
  name: string
  isRight?: boolean
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
  const renderItem = ({ id, name, extra }: Item) => (
    <div
      key={id}
      className={cn(id === value ? `${s.itemActive} text-gray-900` : 'text-gray-500', 'relative flex items-center pb-1.5 leading-6 cursor-pointer')}
      onClick={() => onChange(id)}
    >
      <div className='text-base font-semibold'>{name}</div>
      {extra || ''}
    </div>
  )
  return (
    <div className='flex justify-between border-b border-gray-200 '>
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
