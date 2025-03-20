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
          'h-4 w-4 cursor-pointer rounded-[4px] border border-components-checkbox-border bg-components-checkbox-bg-unchecked shadow-xs hover:border-components-checkbox-border-hover',
          mixed ? s.mixed : 'hover:bg-components-checkbox-bg-unchecked-hover',
          disabled && 'cursor-not-allowed border-components-checkbox-border-disabled bg-components-checkbox-bg-disabled hover:border-components-checkbox-border-disabled hover:bg-components-checkbox-bg-disabled',
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
        'flex h-4 w-4 cursor-pointer items-center justify-center rounded-[4px] bg-components-checkbox-bg text-components-checkbox-icon shadow-xs hover:bg-components-checkbox-bg-hover',
        disabled && 'cursor-not-allowed bg-components-checkbox-bg-disabled-checked text-components-checkbox-icon-disabled hover:bg-components-checkbox-bg-disabled-checked',
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
