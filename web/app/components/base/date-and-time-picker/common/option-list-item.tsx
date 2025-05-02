import React, { type FC, useEffect, useRef } from 'react'
import cn from '@/utils/classnames'

type OptionListItemProps = {
  isSelected: boolean
  onClick: () => void
} & React.LiHTMLAttributes<HTMLLIElement>

const OptionListItem: FC<OptionListItemProps> = ({
  isSelected,
  onClick,
  children,
}) => {
  const listItemRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (isSelected)
      listItemRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  return (
    <li
      ref={listItemRef}
      className={cn(
        'px-1.5 py-1 rounded-md flex items-center justify-center text-components-button-ghost-text system-xs-medium cursor-pointer',
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
