'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  title: string
  onSelect: () => void
  isSelected: boolean
  textCenter?: boolean
}

const RadioCardItem: FC<Props> = ({
  className,
  title,
  onSelect,
  isSelected,
  textCenter,
}) => {
  const handleSelect = useCallback(() => {
    if (isSelected)
      return
    onSelect()
  }, [onSelect, isSelected])
  return (
    <div
      className={cn(
        isSelected ? 'bg-white border-[2px] border-primary-400  shadow-xs' : 'bg-gray-25 border border-gray-100',
        'flex items-center h-8 rounded-lg text-[13px] font-normal text-gray-900 cursor-pointer',
        textCenter ? 'justify-center' : 'px-3',
        className,
      )}
      onClick={handleSelect}
    >
      {title}
    </div>
  )
}
export default React.memo(RadioCardItem)
