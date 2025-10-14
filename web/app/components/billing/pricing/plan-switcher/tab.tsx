import React, { useCallback } from 'react'
import cn from '@/utils/classnames'

type TabProps<T> = {
  Icon: React.ComponentType<{ isActive: boolean }>
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
      className='flex cursor-pointer items-center justify-center gap-x-2 px-5 py-3'
      onClick={handleClick}
    >
      <Icon isActive={isActive} />
      <span
        className={cn(
          'system-xl-semibold text-text-secondary',
          isActive && 'text-saas-dify-blue-accessible',
        )}
      >
        {label}
      </span>
    </div>
  )
}

export default React.memo(Tab) as typeof Tab
