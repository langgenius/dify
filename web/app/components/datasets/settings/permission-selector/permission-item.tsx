import { RiCheckLine } from '@remixicon/react'
import * as React from 'react'

type PermissionItemProps = {
  leftIcon: React.ReactNode
  text: string
  onClick: () => void
  isSelected: boolean
}

const PermissionItem = ({
  leftIcon,
  text,
  onClick,
  isSelected,
}: PermissionItemProps) => {
  return (
    <div
      className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1 hover:bg-state-base-hover"
      onClick={onClick}
    >
      {leftIcon}
      <div className="system-md-regular grow px-1 text-text-secondary">
        {text}
      </div>
      {isSelected && <RiCheckLine className="size-4 text-text-accent" />}
    </div>
  )
}

export default React.memo(PermissionItem)
