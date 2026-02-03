import type { RemixiconComponentType } from '@remixicon/react'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import Divider from '../divider'
import './index.css'

type SegmentedControlOption<T> = {
  value: T
  text?: string
  Icon?: RemixiconComponentType
  count?: number
  disabled?: boolean
}

type SegmentedControlProps<T extends string | number | symbol> = {
  options: SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  activeClassName?: string
  btnClassName?: string
}

const SegmentedControlVariants = cva(
  'segmented-control',
  {
    variants: {
      size: {
        regular: 'segmented-control-regular',
        small: 'segmented-control-small',
        large: 'segmented-control-large',
      },
      padding: {
        none: 'no-padding',
        with: 'padding',
      },
    },
    defaultVariants: {
      size: 'regular',
      padding: 'with',
    },
  },
)

const SegmentedControlItemVariants = cva(
  'segmented-control-item disabled:segmented-control-item-disabled',
  {
    variants: {
      size: {
        regular: ['segmented-control-item-regular', 'system-sm-medium'],
        small: ['segmented-control-item-small', 'system-xs-medium'],
        large: ['segmented-control-item-large', 'system-md-semibold'],
      },
      activeState: {
        default: '',
        accent: 'accent',
        accentLight: 'accent-light',
      },
    },
    defaultVariants: {
      size: 'regular',
      activeState: 'default',
    },
  },
)

const ItemTextWrapperVariants = cva(
  'item-text',
  {
    variants: {
      size: {
        regular: 'item-text-regular',
        small: 'item-text-small',
        large: 'item-text-large',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)

export const SegmentedControl = <T extends string | number | symbol>({
  options,
  value,
  onChange,
  className,
  size,
  padding,
  activeState,
  activeClassName,
  btnClassName,
}: SegmentedControlProps<T>
  & VariantProps<typeof SegmentedControlVariants>
  & VariantProps<typeof SegmentedControlItemVariants>
  & VariantProps<typeof ItemTextWrapperVariants>) => {
  const selectedOptionIndex = options.findIndex(option => option.value === value)

  return (
    <div className={cn(
      SegmentedControlVariants({ size, padding }),
      className,
    )}
    >
      {options.map((option, index) => {
        const { Icon, text, count, disabled } = option
        const isSelected = index === selectedOptionIndex
        const isNextSelected = index === selectedOptionIndex - 1
        const isLast = index === options.length - 1
        return (
          <button
            type="button"
            key={String(option.value)}
            className={cn(
              isSelected ? 'active' : 'default',
              SegmentedControlItemVariants({ size, activeState: isSelected ? activeState : 'default' }),
              isSelected && activeClassName,
              disabled && 'disabled',
              btnClassName,
            )}
            onClick={() => {
              if (!isSelected)
                onChange(option.value)
            }}
            disabled={disabled}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            {text && (
              <div className={cn('inline-flex items-center gap-x-1', ItemTextWrapperVariants({ size }))}>
                <span>{text}</span>
                {!!(count && size === 'large') && (
                  <div className="system-2xs-medium-uppercase inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] text-text-tertiary">
                    {count}
                  </div>
                )}
              </div>
            )}
            {!isLast && !isSelected && !isNextSelected && (
              <div data-testid={`segmented-control-divider-${index}`} className="absolute right-[-1px] top-0 flex h-full items-center">
                <Divider type="vertical" className="mx-0 h-3.5" />
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default React.memo(SegmentedControl)
