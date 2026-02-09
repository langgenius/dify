'use client'
import type { VariantProps } from 'class-variance-authority'
import type { FC } from 'react'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { useCallback } from 'react'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'

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
})

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
        'flex h-8 cursor-default items-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 text-text-secondary system-sm-regular',
        (!selected && !disabled) && 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
        selected && 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs system-sm-medium',
        disabled && 'text-text-disabled',
        variants({ align }),
        className,
      )}
      onClick={handleSelect}
    >
      <span>{title}</span>
      {tooltip
        && (
          <Tooltip
            popupContent={(
              <div className="w-[240px]">
                {tooltip}
              </div>
            )}
          />
        )}
    </div>
  )
}

export default React.memo(OptionCard)
