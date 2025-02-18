'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'

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
  tooltip?: string
} & VariantProps<typeof variants>

const OptionCard: FC<Props> = ({
  className,
  title,
  onSelect,
  selected,
  disabled,
  align = 'center',
  tooltip,
}) => {
  const handleSelect = useCallback(() => {
    if (selected || disabled)
      return
    onSelect()
  }, [onSelect, selected, disabled])

  return (
    <div
      className={cn(
        'system-sm-regular bg-components-option-card-option-bg border-components-option-card-option-border text-text-secondary flex h-8 cursor-default items-center rounded-md border px-2',
        (!selected && !disabled) && 'hover:bg-components-option-card-option-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs cursor-pointer',
        selected && 'bg-components-option-card-option-selected-bg border-components-option-card-option-selected-border system-sm-medium shadow-xs border-[1.5px]',
        disabled && 'text-text-disabled',
        variants({ align }),
        className,
      )}
      onClick={handleSelect}
    >
      <span>{title}</span>
      {tooltip
        && <Tooltip
          popupContent={
            <div className='w-[240px]'>
              {tooltip}
            </div>
          }
        />
      }
    </div>
  )
}

export default React.memo(OptionCard)
