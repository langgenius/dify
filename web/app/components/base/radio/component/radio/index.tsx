import type { ReactElement } from 'react'
import { useId } from 'react'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import RadioGroupContext from '../../context'
import s from '../../style.module.css'

export type IRadioProps = {
  className?: string
  children?: string | ReactElement
  checked?: boolean
  value?: string | number
  disabled?: boolean
  onChange?: (e: any) => void
}

export default function Radio({
  className = '',
  children = '',
  checked,
  value,
  disabled,
  onChange,
}: IRadioProps): JSX.Element {
  const groupContext = useContext(RadioGroupContext)
  const labelId = useId()
  const handleChange = (e: any) => {
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
          cn('text-sm cursor-pointer')
        }
          id={labelId}
        >
          {children}
        </label>
      )}
    </div>
  )
}
