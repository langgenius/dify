'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'
import cn from '@/utils/classnames'

export type IProgressProps = {
  className?: string
  value: number // percent
}

const Progress: FC<IProgressProps> = ({
  className,
  value,
}) => {
  const exhausted = value === 100
  return (
    <div className={cn(className, 'relative grow h-2 flex bg-gray-200 rounded-md overflow-hidden')}>
      <div
        className={cn(s.bar, exhausted && s['bar-error'], 'absolute top-0 left-0 right-0 bottom-0')}
        style={{ width: `${value}%` }}
      />
      {Array(10).fill(0).map((i, k) => (
        <div key={k} className={s['bar-item']} />
      ))}
    </div>
  )
}
export default React.memo(Progress)
