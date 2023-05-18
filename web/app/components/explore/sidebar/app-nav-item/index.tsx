'use client'
import cn from 'classnames'
import Link from 'next/link'
import ItemOperation from '@/app/components/explore/item-operation'

import s from './style.module.css'

export default function NavLink({
  name,
  id,
  isSelected,
}: {
  name: string
  id: string
  isSelected: boolean
}) {
  const url = `/explore/installed/${id}`
  
  return (
    <Link
      prefetch
      key={name}
      href={url}
      className={cn(
        s.item,
        isSelected && s.active,
        'flex h-8 items-center px-2 rounded-lg text-sm font-normal hover:bg-gray-200',
      )}
    >
      <div
        className={cn(
          'shrink-0 mr-2 h-6 w-6 rounded-md border bg-[#D5F5F6]',
        )}
        style={{
          borderColor: '0.5px solid rgba(0, 0, 0, 0.05)'
        }}
      />
      <div className='overflow-hidden text-ellipsis whitespace-nowrap'>{name}</div>
      <div onClick={e => e.stopPropagation()}>
        <ItemOperation className={s.opBtn} />
      </div>
    </Link>
  )
}
