import { RiCheckLine } from '@remixicon/react'
import s from './index.module.css'
import cn from '@/utils/classnames'

type CheckboxProps = {
  checked?: boolean
  onCheck?: () => void
  className?: string
  disabled?: boolean
  mixed?: boolean
}

const Checkbox = ({ checked, onCheck, className, disabled, mixed }: CheckboxProps) => {
  if (!checked) {
    return (
      <div
        className={cn(
          'bg-components-checkbox-bg-unchecked border-components-checkbox-border hover:bg-components-checkbox-bg-unchecked-hover hover:border-components-checkbox-border-hover shadow-xs h-4 w-4 cursor-pointer rounded-[4px] border',
          disabled && 'border-components-checkbox-border-disabled bg-components-checkbox-bg-disabled hover:border-components-checkbox-border-disabled hover:bg-components-checkbox-bg-disabled cursor-not-allowed',
          mixed && s.mixed,
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
        'bg-components-checkbox-bg hover:bg-components-checkbox-bg-hover text-components-checkbox-icon shadow-xs flex h-4 w-4 cursor-pointer items-center justify-center rounded-[4px]',
        disabled && 'bg-components-checkbox-bg-disabled-checked hover:bg-components-checkbox-bg-disabled-checked text-components-checkbox-icon-disabled cursor-not-allowed',
        className,
      )}
      onClick={() => {
        if (disabled)
          return

        onCheck?.()
      }}
    >
      <RiCheckLine className={cn('h-3 w-3')} />
    </div>
  )
}

export default Checkbox
