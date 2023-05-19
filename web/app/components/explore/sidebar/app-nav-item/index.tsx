'use client'
import cn from 'classnames'
import { useRouter } from 'next/navigation'
import ItemOperation from '@/app/components/explore/item-operation'

import s from './style.module.css'

export default function NavLink({
  name,
  id,
  isSelected,
  onDelete
}: {
  name: string
  id: string
  isSelected: boolean
  onDelete: (id: string) => void
}) {
  const router = useRouter()
  const url = `/explore/installed/${id}`
  
  return (
    <div
      key={id}
      className={cn(
        s.item,
        isSelected ? s.active : 'hover:bg-gray-200',
        'flex h-8 justify-between px-2 rounded-lg text-sm font-normal ',
      )}
      onClick={() => { 
        router.push(url) // use Link causes popup item always trigger jump. Can not be solved by e.stopPropagation().
      }}
    >
      <div className='flex items-center'>
        <div
          className={cn(
            'shrink-0 mr-2 h-6 w-6 rounded-md border bg-[#D5F5F6]',
          )}
          style={{
            borderColor: '0.5px solid rgba(0, 0, 0, 0.05)'
          }}
        />
        <div className='max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap'>{name}</div>
      </div>
      {
        !isSelected && (
          <div className={cn(s.opBtn, 'shrink-0')} onClick={e => e.stopPropagation()}>
            <ItemOperation
              // isShowDelete={}
              onDelete={() => onDelete(id)}
            />
          </div>
        )
      }
    </div>
  )
}
