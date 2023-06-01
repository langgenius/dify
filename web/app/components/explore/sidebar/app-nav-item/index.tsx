'use client'
import cn from 'classnames'
import { useRouter } from 'next/navigation'
import s from './style.module.css'
import ItemOperation from '@/app/components/explore/item-operation'
import AppIcon from '@/app/components/base/app-icon'

export type IAppNavItemProps = {
  name: string
  id: string
  icon: string
  icon_background: string
  isSelected: boolean
  isPinned: boolean
  togglePin: () => void
  uninstallable: boolean
  onDelete: (id: string) => void
}

export default function AppNavItem({
  name,
  id,
  icon,
  icon_background,
  isSelected,
  isPinned,
  togglePin,
  uninstallable,
  onDelete,
}: IAppNavItemProps) {
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
      <div className='flex items-center space-x-2 w-0 grow'>
        {/* <div
          className={cn(
            'shrink-0 mr-2 h-6 w-6 rounded-md border bg-[#D5F5F6]',
          )}
          style={{
            borderColor: '0.5px solid rgba(0, 0, 0, 0.05)'
          }}
        /> */}
        <AppIcon size='tiny' icon={icon} background={icon_background} />
        <div className='overflow-hidden text-ellipsis whitespace-nowrap'>{name}</div>
      </div>
      {
        !isSelected && (
          <div className={cn(s.opBtn, 'shrink-0')} onClick={e => e.stopPropagation()}>
            <ItemOperation
              isPinned={isPinned}
              togglePin={togglePin}
              isShowDelete={!uninstallable}
              onDelete={() => onDelete(id)}
            />
          </div>
        )
      }
    </div>
  )
}
