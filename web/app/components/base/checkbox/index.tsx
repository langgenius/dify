import s from './index.module.css'
import cn from '@/utils/classnames'

type CheckboxProps = {
  checked?: boolean
  onCheck?: () => void
  className?: string
  disabled?: boolean
}

const Checkbox = ({ checked, onCheck, className, disabled }: CheckboxProps) => {
  return (
    <div
      className={cn(
        s.wrapper,
        checked && s.checked,
        disabled && s.disabled,
        'w-4 h-4 border rounded border-gray-300',
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
