import type { ReactNode } from 'react'
import type { DatasetPermission } from '@/models/datasets'
import { PopoverClose } from '@langgenius/dify-ui/popover'
import { RadioItem } from '@langgenius/dify-ui/radio'

type PermissionItemProps = {
  value: DatasetPermission
  leftIcon: ReactNode
  text: string
  isSelected: boolean
  closeOnSelect?: boolean
}

const className =
  'flex w-full touch-manipulation cursor-pointer items-center gap-x-1 rounded-lg border-none bg-transparent px-2 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const PermissionItem = ({
  value,
  leftIcon,
  text,
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
      <PopoverClose render={<RadioItem<DatasetPermission> value={value} />} className={className}>
        {content}
      </PopoverClose>
    )
  }

  return (
    <RadioItem<DatasetPermission> value={value} className={className}>
      {content}
    </RadioItem>
  )
}

export default PermissionItem
