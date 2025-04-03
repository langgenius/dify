'use client'
import type { FC, PropsWithChildren } from 'react'

type AccessControlItemProps = PropsWithChildren<{
  active: boolean
}>

const AccessControlItem: FC<AccessControlItemProps> = ({ active, children }) => {
  if (!active) {
    return <div className="rounded-[10px] border-[1px] cursor-pointer
      border-components-option-card-option-border bg-components-option-card-option-bg
      hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover">
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
