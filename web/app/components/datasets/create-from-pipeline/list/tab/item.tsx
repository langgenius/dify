import cn from '@/utils/classnames'
import React from 'react'

type ItemProps = {
  isSelected: boolean
  option: { value: string; label: string }
  onClick: (value: string) => void
}

const Item = ({
  isSelected,
  option,
  onClick,
}: ItemProps) => {
  return (
    <div
      className={cn(
        'system-sm-semibold-uppercase relative flex h-full cursor-pointer items-center',
        isSelected ? 'text-text-primary' : 'text-text-tertiary',
      )}
      onClick={onClick.bind(null, option.value)}
    >
      <span>{option.label}</span>
      {isSelected && <div className='absolute bottom-0 left-0 h-0.5 w-full bg-util-colors-blue-brand-blue-brand-600' />}
    </div>
  )
}

export default React.memo(Item)
