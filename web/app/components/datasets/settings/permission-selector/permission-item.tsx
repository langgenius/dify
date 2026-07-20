import type { ReactNode } from 'react'
import { PopoverClose } from '@langgenius/dify-ui/popover'

type PermissionItemProps = {
  leftIcon: ReactNode
  text: string
  onClick: () => void
  isSelected: boolean
  closeOnSelect?: boolean
}

const className =
  'flex w-full touch-manipulation cursor-pointer items-center gap-x-1 rounded-lg border-none bg-transparent px-2 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const PermissionItem = ({
  leftIcon,
  text,
  onClick,
  isSelected,
  closeOnSelect = false,
}: PermissionItemProps) => {
  const content = (
    <>
      {leftIcon}
      <div className="grow px-1 system-md-regular text-text-secondary">{text}</div>
      {isSelected && (
        <span aria-hidden="true" className="i-ri-check-line size-4 text-text-accent" />
      )}
    </>
  )

  if (closeOnSelect) {
    return (
      <PopoverClose type="button" className={className} aria-pressed={isSelected} onClick={onClick}>
        {content}
      </PopoverClose>
    )
  }

  return (
    <button type="button" className={className} aria-pressed={isSelected} onClick={onClick}>
      {content}
    </button>
  )
}

export default PermissionItem
