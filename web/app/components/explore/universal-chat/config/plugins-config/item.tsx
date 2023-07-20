'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import s from './item.module.css'
import Switch from '@/app/components/base/switch'

export type IItemProps = {
  icon: React.ReactNode
  name: string
  description?: string
  more?: React.ReactNode
  enabled: boolean
  onChange: (enabled: boolean) => void
  readonly?: boolean
}

const Item: FC<IItemProps> = ({
  icon,
  name,
  description,
  more,
  enabled,
  onChange,
  readonly,
}) => {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 overflow-hidden', s.shadow)}>
      <div className='flex justify-between items-center min-h-[48px] px-2'>
        <div className='flex items-center space-x-2'>
          {icon}
          <div className='leading-[18px]'>
            <div className='text-[13px] font-medium text-gray-800'>{name}</div>
            {description && <div className='text-xs leading-[18px] text-gray-500'>{description}</div>}
          </div>
        </div>
        <Switch size='md' defaultValue={enabled} onChange={onChange} disabled={readonly} />
      </div>
      {more}
    </div>
  )
}
export default React.memo(Item)
