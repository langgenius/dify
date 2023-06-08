import cn from 'classnames'

type CheckboxProps = {
  checked?: boolean
  onCheck?: () => void
  className?: string
}

const Checkbox = ({ checked, onCheck, className }: CheckboxProps) => {
  return (
    <div
      className={cn('w-4 h-4 border rounded', checked ? 'border-primary-600 bg-primary-600' : 'border-gray-300', className)}
      onClick={onCheck}
    />
  )
}

export default Checkbox
