import { RiCheckLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import IndeterminateIcon from './assets/indeterminate-icon'

type CheckboxProps = {
  id?: string
  checked?: boolean
  onCheck?: () => void
  className?: string
  disabled?: boolean
  indeterminate?: boolean
}

const Checkbox = ({ id, checked, onCheck, className, disabled, indeterminate }: CheckboxProps) => {
  if (!checked) {
    return (
      <div
        id={id}
        className={cn(
          'flex h-4 w-4 cursor-pointer items-center justify-center rounded-[4px] border border-components-checkbox-border bg-components-checkbox-bg-unchecked shadow-xs',
          indeterminate ? 'border-none bg-components-checkbox-bg text-components-checkbox-icon' : 'hover:bg-components-checkbox-bg-unchecked-hover',
          disabled && 'cursor-not-allowed border-components-checkbox-border-disabled bg-components-checkbox-bg-disabled text-components-checkbox-icon-disabled hover:border-components-checkbox-border-disabled hover:bg-components-checkbox-bg-disabled',
          className,
        )}
        onClick={() => {
          if (disabled)
            return
          onCheck?.()
        }}
      >
        {indeterminate && (
          <IndeterminateIcon />
        )}
      </div>
    )
  }
  return (
    <div
      id={id}
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
      <RiCheckLine className='h-3 w-3' />
    </div>
  )
}

export default Checkbox
