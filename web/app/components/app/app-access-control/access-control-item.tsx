'use client'
import type { FC, PropsWithChildren } from 'react'
import type { AccessControlType } from './access-control-store'
import useAccessControlStore from './access-control-store'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessControlType
}>

const AccessControlItem: FC<AccessControlItemProps> = ({ type, children }) => {
  const { currentMenu, setCurrentMenu } = useAccessControlStore(s => ({ currentMenu: s.currentMenu, setCurrentMenu: s.setCurrentMenu }))
  if (currentMenu !== type) {
    return <div
      className="rounded-[10px] border-[1px] cursor-pointer
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
