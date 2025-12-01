'use client'
import type { FC, PropsWithChildren } from 'react'
import useAccessControlStore from '@/context/access-control-store'
import type { AccessMode } from '@/models/access-control'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessMode
}>

const AccessControlItem: FC<AccessControlItemProps> = ({ type, children }) => {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  if (currentMenu !== type) {
    return <div
      className="cursor-pointer rounded-[10px] border-[1px]
      border-components-option-card-option-border bg-components-option-card-option-bg
      hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover"
      onClick={() => setCurrentMenu(type)} >
      {children}
    </div>
  }

  return <div className="rounded-[10px] border-[1.5px]
  border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-sm">
    {children}
  </div>
}

AccessControlItem.displayName = 'AccessControlItem'

export default AccessControlItem
