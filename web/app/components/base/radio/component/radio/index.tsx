import type { ReactElement } from 'react'
import { useId } from 'react'
import { useContext } from 'use-context-selector'
import RadioGroupContext from '../../context'
import s from '../../style.module.css'
import cn from '@/utils/classnames'

export type IRadioProps = {
  className?: string
  labelClassName?: string
  children?: string | ReactElement
  checked?: boolean
  value?: string | number
  disabled?: boolean
  onChange?: (e?: IRadioProps['value']) => void
}

export default function Radio({
  className = '',
  labelClassName,
  children = '',
  checked,
  value,
  disabled,
  onChange,
}: IRadioProps): JSX.Element {
  const groupContext = useContext(RadioGroupContext)
  const labelId = useId()
  const handleChange = (e: IRadioProps['value']) => {
    if (disabled)
      return

    onChange?.(e)
    groupContext?.onChange(e)
  }

  const isChecked = groupContext ? groupContext.value === value : checked
  const divClassName = `
    flex items-center py-1 relative
    px-7 cursor-pointer hover:bg-gray-200 rounded
  `

  return (
    <div className={cn(
      s.label,
      disabled ? s.disabled : '',
      isChecked ? 'bg-white shadow' : '',
      divClassName,
      className)}
    onClick={() => handleChange(value)}
    >
      {children && (
        <label className={
          cn(labelClassName, 'text-sm cursor-pointer')
        }
        id={labelId}
        >
          {children}
        </label>
      )}
    </div>
  )
}
