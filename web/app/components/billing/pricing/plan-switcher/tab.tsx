import React, { useCallback } from 'react'
import cn from '@/utils/classnames'

type TabProps<T> = {
  Icon: React.ComponentType<any>
  value: T
  label: string
  isActive: boolean
  onClick: (value: T) => void
}

const Tab = <T,>({
  Icon,
  value,
  label,
  isActive,
  onClick,
}: TabProps<T>) => {
  const handleClick = useCallback(() => {
    onClick(value)
  }, [onClick, value])

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center justify-center gap-x-2 px-5 py-3 text-text-secondary',
        isActive && 'text-saas-dify-blue-accessible',
      )}
      onClick={handleClick}
    >
      <Icon className='size-4' />
      <span className='system-xl-semibold'>{label}</span>
    </div>
  )
}

export default React.memo(Tab) as typeof Tab
