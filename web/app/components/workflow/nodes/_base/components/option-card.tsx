'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import cn from '@/utils/classnames'

const variants = cva([], {
  variants: {
    align: {
      left: 'justify-start',
      center: 'justify-center',
      right: 'justify-end',
    },
  },
  defaultVariants: {
    align: 'center',
  },
},
)

type Props = {
  className?: string
  title: string
  onSelect: () => void
  selected: boolean
  disabled?: boolean
  align?: 'left' | 'center' | 'right'
} & VariantProps<typeof variants>

const OptionCard: FC<Props> = ({
  className,
  title,
  onSelect,
  selected,
  disabled,
  align = 'center',
}) => {
  const handleSelect = useCallback(() => {
    if (selected || disabled)
      return
    onSelect()
  }, [onSelect, selected, disabled])

  return (
    <div
      className={cn(
        'flex items-center px-2 h-8 rounded-md system-sm-regular bg-components-option-card-option-bg border border-components-option-card-option-border text-text-secondary cursor-default',
        (!selected && !disabled) && 'hover:bg-components-option-card-option-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs cursor-pointer',
        selected && 'bg-components-option-card-option-selected-bg border-[1.5px] border-components-option-card-option-selected-border system-sm-medium shadow-xs',
        disabled && 'text-text-disabled',
        variants({ align }),
        className,
      )}
      onClick={handleSelect}
    >
      {title}
    </div>
  )
}

export default React.memo(OptionCard)
