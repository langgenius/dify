import cn from 'classnames'
import s from './index.module.css'

type CheckboxProps = {
  checked?: boolean
  onCheck?: () => void
  className?: string
}

const Checkbox = ({ checked, onCheck, className }: CheckboxProps) => {
  return (
    <div
      className={cn(s.wrapper, checked && s.checked, 'w-4 h-4 border rounded border-gray-300', className)}
      onClick={onCheck}
    />
  )
}

export default Checkbox
