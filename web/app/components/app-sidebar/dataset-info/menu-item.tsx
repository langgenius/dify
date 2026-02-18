import type { RemixiconComponentType } from '@remixicon/react'
import * as React from 'react'

type MenuItemProps = {
  name: string
  Icon: RemixiconComponentType
  handleClick?: () => void
}

const MenuItem = ({
  Icon,
  name,
  handleClick,
}: MenuItemProps) => {
  return (
    <div
      className="flex items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleClick?.()
      }}
    >
      <Icon className="size-4 text-text-tertiary" />
      <span className="system-md-regular px-1 text-text-secondary">{name}</span>
    </div>
  )
}

export default React.memo(MenuItem)
