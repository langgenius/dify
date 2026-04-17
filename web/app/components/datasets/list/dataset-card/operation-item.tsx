import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type OperationItemProps = {
  iconClassName: string
  name: string
  handleClick?: () => void
}

const OperationItem = ({
  iconClassName,
  name,
  handleClick,
}: OperationItemProps) => {
  return (
    <div
      className="flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        handleClick?.()
      }}
    >
      <span aria-hidden className={cn(iconClassName, 'size-4 text-text-tertiary')} />
      <span className="px-1 system-md-regular text-text-secondary">
        {name}
      </span>
    </div>
  )
}

export default React.memo(OperationItem)
