import type { FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useRef } from 'react'

type OptionListItemProps = {
  isSelected: boolean
  onClick: () => void
  noAutoScroll?: boolean
  children: ReactNode
}

const OptionListItem: FC<OptionListItemProps> = ({
  isSelected,
  onClick,
  noAutoScroll,
  children,
}) => {
  const listItemRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (isSelected && !noAutoScroll)
      listItemRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  return (
    <li
      ref={listItemRef}
    >
      <button
        type="button"
        className={cn(
          'flex w-full cursor-pointer items-center justify-center rounded-md px-1.5 py-1 system-xs-medium text-components-button-ghost-text outline-hidden',
          'focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:ring-inset',
          isSelected ? 'bg-components-button-ghost-bg-hover' : 'hover:bg-components-button-ghost-bg-hover',
        )}
        onClick={() => {
          listItemRef.current?.scrollIntoView({ behavior: 'smooth' })
          onClick()
        }}
      >
        {children}
      </button>
    </li>
  )
}

export default React.memo(OptionListItem)
