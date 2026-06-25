'use client'
import type { FC, KeyboardEvent, PropsWithChildren } from 'react'
import type { AccessMode } from '@/models/access-control'
import useAccessControlStore from '@/context/access-control-store'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessMode
}>

const AccessControlItem: FC<AccessControlItemProps> = ({ type, children }) => {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  const handleSelect = () => setCurrentMenu(type)
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return

    event.preventDefault()
    handleSelect()
  }

  if (currentMenu !== type) {
    return (
      <div
        role="radio"
        aria-checked={false}
        tabIndex={0}
        className="cursor-pointer rounded-[10px] border
      border-components-option-card-option-border bg-components-option-card-option-bg
      hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover"
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      role="radio"
      aria-checked
      className="rounded-[10px] border-[1.5px]
  border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-sm"
    >
      {children}
    </div>
  )
}

AccessControlItem.displayName = 'AccessControlItem'

export default AccessControlItem
