import type { ReactNode } from 'react'
import { useId } from 'react'
import { useContext } from 'use-context-selector'
import RadioGroupContext from '../../context'
import s from '../../style.module.css'
import cn from '@/utils/classnames'

export type IRadioProps = {
  className?: string
  labelClassName?: string
  children?: string | ReactNode
  checked?: boolean
  value?: string | number | boolean
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
}: IRadioProps): React.JSX.Element {
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
    px-7 cursor-pointer text-text-secondary rounded
    hover:bg-components-option-card-option-bg-hover hover:shadow-xs
  `

  return (
    <div className={cn(
      s.label,
      disabled ? s.disabled : '',
      isChecked ? 'bg-components-option-card-option-bg-hover shadow-xs' : '',
      divClassName,
      className)}
    onClick={() => handleChange(value)}
    >
      {children && (
        <label className={
          cn(labelClassName, 'cursor-pointer text-sm')
        }
        id={labelId}
        >
          {children}
        </label>
      )}
    </div>
  )
}
