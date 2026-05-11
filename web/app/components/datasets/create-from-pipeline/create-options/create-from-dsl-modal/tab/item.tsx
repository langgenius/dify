import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type ItemProps = {
  isActive: boolean
  label: string
  onClick: () => void
}

const Item = ({
  isActive,
  label,
  onClick,
}: ItemProps) => {
  return (
    <div
      className={cn(
        'relative flex h-full cursor-pointer items-center system-md-semibold text-text-tertiary',
        isActive && 'text-text-primary',
      )}
      onClick={onClick}
    >
      {label}
      {
        isActive && (
          <div className="absolute bottom-0 h-0.5 w-full bg-util-colors-blue-brand-blue-brand-600" />
        )
      }
    </div>
  )
}

export default React.memo(Item)
