import * as React from 'react'
import { useCallback } from 'react'
import { cn } from '@/utils/classnames'

type BreadcrumbItemProps = {
  name: string
  index: number
  handleClick: (index: number) => void
  disabled?: boolean
  isActive?: boolean
  showSeparator?: boolean
}

const BreadcrumbItem = ({
  name,
  index,
  handleClick,
  disabled = false,
  isActive = false,
  showSeparator = true,
}: BreadcrumbItemProps) => {
  const handleClickItem = useCallback(() => {
    if (!disabled)
      handleClick(index)
  }, [disabled, handleClick, index])

  return (
    <>
      <button
        type="button"
        className={cn(
          'max-w-full shrink truncate rounded-md px-[5px] py-1',
          isActive ? 'system-sm-medium text-text-secondary' : 'system-sm-regular text-text-tertiary',
          !disabled && 'hover:bg-state-base-hover',
        )}
        disabled={disabled}
        onClick={handleClickItem}
        title={name}
      >
        {name}
      </button>
      {showSeparator && <span className="system-xs-regular shrink-0 text-divider-deep">/</span>}
    </>
  )
}

BreadcrumbItem.displayName = 'BreadcrumbItem'

export default React.memo(BreadcrumbItem)
