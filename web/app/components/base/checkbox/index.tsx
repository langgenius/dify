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
  return (
    <div
      className={cn(
        'w-4 h-4 border rounded border-components-checkbox-border bg-components-checkbox-bg-unchecked shadow-xs shadow-shadow-shadow-3',
        checked && s.checked,
        disabled && s.disabled,
        mixed && s.mixed,
        className,
      )}
      onClick={() => {
        if (disabled)
          return

        onCheck?.()
      }}
    />
  )
}

export default Checkbox
