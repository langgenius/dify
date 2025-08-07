import React, { type FC, useEffect, useRef } from 'react'
import cn from '@/utils/classnames'

type OptionListItemProps = {
  isSelected: boolean
  onClick: () => void
  noAutoScroll?: boolean
} & React.LiHTMLAttributes<HTMLLIElement>

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
      className={cn(
        'system-xs-medium flex cursor-pointer items-center justify-center rounded-md px-1.5 py-1 text-components-button-ghost-text',
        isSelected ? 'bg-components-button-ghost-bg-hover' : 'hover:bg-components-button-ghost-bg-hover',
      )}
      onClick={() => {
        listItemRef.current?.scrollIntoView({ behavior: 'smooth' })
        onClick()
      }}
    >
      {children}
    </li>
  )
}

export default React.memo(OptionListItem)
