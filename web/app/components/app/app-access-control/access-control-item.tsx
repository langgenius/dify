'use client'
import type { FC, PropsWithChildren } from 'react'
import type { AccessMode } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import useAccessControlStore from '@/context/access-control-store'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessMode
  disabled?: boolean
}>

const AccessControlItem: FC<AccessControlItemProps> = ({ type, children, disabled }) => {
  const currentMenu = useAccessControlStore((s) => s.currentMenu)
  const setCurrentMenu = useAccessControlStore((s) => s.setCurrentMenu)
  if (currentMenu !== type) {
    const selectOption = () => !disabled && setCurrentMenu(type)
    return (
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={cn(
          'rounded-[10px] border border-components-option-card-option-border bg-components-option-card-option-bg',
          'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
        )}
        aria-disabled={disabled}
        onClick={selectOption}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            selectOption()
          }
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <div className="rounded-[10px] border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-sm">
      {children}
    </div>
  )
}

AccessControlItem.displayName = 'AccessControlItem'

export default AccessControlItem
