import type { RemixiconComponentType } from '@remixicon/react'
import { memo } from 'react'

type MenuItemProps = {
  name: string
  Icon: RemixiconComponentType
  handleClick?: () => void
}

const MenuItem = ({ Icon, name, handleClick }: MenuItemProps) => {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-x-1 rounded-lg px-2 py-1.5 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleClick?.()
      }}
    >
      <Icon aria-hidden className="size-4 text-text-tertiary" />
      <span className="px-1 system-md-regular text-text-secondary">{name}</span>
    </button>
  )
}

export default memo(MenuItem)
