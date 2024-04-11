'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import s from './style.module.css'

type OPTION = {
  label: string
  value: any
}

type Props = {
  className?: string
  options: OPTION[]
  value: any
  onChange: (value: any) => void
}

const RadioGroup: FC<Props> = ({
  className = '',
  options,
  value,
  onChange,
}) => {
  return (
    <div className={cn(className, 'flex')}>
      {options.map(item => (
        <div
          key={item.value}
          className={cn(s.item, item.value === value && s.checked)}
          onClick={() => onChange(item.value)}
        >
          <div className={s.radio}></div>
          <div className='text-[13px] font-medium text-gray-900'>{item.label}</div>
        </div>
      ))}
    </div>
  )
}
export default React.memo(RadioGroup)
