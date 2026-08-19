import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback } from 'react'

type TabProps<T> = {
  Icon: React.ComponentType<{ isActive: boolean }>
  value: T
  label: string
  isActive: boolean
  onClick: (value: T) => void
}

const Tab = <T,>({ Icon, value, label, isActive, onClick }: TabProps<T>) => {
  const handleClick = useCallback(() => {
    onClick(value)
  }, [onClick, value])

  return (
    <button
      type="button"
      aria-pressed={isActive}
      className="flex cursor-pointer appearance-none items-center justify-center gap-x-2 px-5 py-3 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
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
    </button>
  )
}

export default React.memo(Tab) as typeof Tab
