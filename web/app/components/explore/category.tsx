'use client'
import React, { FC } from 'react'
import cn from 'classnames'

export interface ICategoryProps {
  className?: string
  list: string[]
  value: string
  onChange: (value: string) => void
}

const Category: FC<ICategoryProps> = ({
  className,
  list,
  value,
  onChange
}) => {
  const itemClassName = (isSelected: boolean) => cn(isSelected ? 'bg-white text-primary-600 border-gray-200 font-semibold' : 'border-transparent font-medium','flex items-center h-7 px-3 border cursor-pointer rounded')
  const itemStyle = (isSelected: boolean) => isSelected ? {boxShadow: '0px 1px 2px rgba(16, 24, 40, 0.05)'} : {}
  return (
    <div className={cn(className, 'flex space-x-1 text-[13px]')}>
      <div 
          className={itemClassName('' === value)}
          style={itemStyle('' === value)}
          onClick={() => onChange('')}
        >
          All Categories
        </div>
      {list.map(name => (
        <div 
          key={name}
          className={itemClassName(name === value)}
          style={itemStyle(name === value)}
          onClick={() => onChange(name)}
        >
          {name}
        </div>
      ))}
    </div>
  )
}
export default React.memo(Category)
