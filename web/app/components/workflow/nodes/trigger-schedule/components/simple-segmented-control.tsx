import React from 'react'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'

// Simplified version without icons
type SimpleSegmentedControlProps<T extends string | number | symbol> = {
  options: { text: string, value: T }[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export const SimpleSegmentedControl = <T extends string | number | symbol>({
  options,
  value,
  onChange,
  className,
}: SimpleSegmentedControlProps<T>) => {
  const selectedOptionIndex = options.findIndex(option => option.value === value)

  return (
    <div className={classNames(
      'flex items-center gap-x-[1px] rounded-lg bg-components-segmented-control-bg-normal p-0.5',
      className,
    )}>
      {options.map((option, index) => {
        const isSelected = index === selectedOptionIndex
        const isNextSelected = index === selectedOptionIndex - 1
        const isLast = index === options.length - 1
        return (
          <button
            type='button'
            key={String(option.value)}
            className={classNames(
              'border-0.5 group relative flex flex-1 items-center justify-center gap-x-0.5 rounded-lg border-transparent px-2 py-1',
              isSelected
                ? 'border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg shadow-xs shadow-shadow-shadow-3'
                : 'hover:bg-state-base-hover',
            )}
            onClick={() => onChange(option.value)}
          >
            <span className={classNames(
              'system-sm-medium p-0.5 text-text-tertiary',
              isSelected ? 'text-text-accent-light-mode-only' : 'group-hover:text-text-secondary',
            )}>
              {option.text}
            </span>
            {!isLast && !isSelected && !isNextSelected && (
              <div className='absolute right-[-1px] top-0 flex h-full items-center'>
                <Divider type='vertical' className='mx-0 h-3.5' />
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default React.memo(SimpleSegmentedControl) as typeof SimpleSegmentedControl
