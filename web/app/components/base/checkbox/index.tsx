import { RiCheckLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type CheckboxProps = {
  checked?: boolean
  onCheck?: () => void
  className?: string
  disabled?: boolean
}

const Checkbox = ({ checked, onCheck, className, disabled }: CheckboxProps) => {
  if (!checked) {
    return (
      <div
        className={cn(
          'w-4 h-4 rounded-[4px] bg-components-checkbox-bg-unchecked border border-components-checkbox-border hover:bg-components-checkbox-bg-unchecked-hover hover:border-components-checkbox-border-hover shadow-xs cursor-pointer',
          disabled && 'border-components-checkbox-border-disabled bg-components-checkbox-bg-disabled hover:border-components-checkbox-border-disabled hover:bg-components-checkbox-bg-disabled cursor-not-allowed',
          className,
        )}
        onClick={() => {
          if (disabled)
            return
          onCheck?.()
        }}
      ></div>
    )
  }
  return (
    <div
      className={cn(
        'w-4 h-4 flex items-center justify-center rounded-[4px] bg-components-checkbox-bg hover:bg-components-checkbox-bg-hover text-components-checkbox-icon shadow-xs cursor-pointer',
        disabled && 'bg-components-checkbox-bg-disabled-checked hover:bg-components-checkbox-bg-disabled-checked text-components-checkbox-icon-disabled cursor-not-allowed',
        className,
      )}
      onClick={() => {
        if (disabled)
          return

        onCheck?.()
      }}
    >
      <RiCheckLine className={cn('w-3 h-3')} />
    </div>
  )
}

export default Checkbox
