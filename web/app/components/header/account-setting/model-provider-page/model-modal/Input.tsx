import type { FC } from 'react'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'

type InputProps = {
  value?: string
  onChange: (v: string) => void
  onFocus?: () => void
  placeholder?: string
  validated?: boolean
  className?: string
  disabled?: boolean
  type?: string
  min?: number
  max?: number
}

const Input: FC<InputProps> = ({
  value,
  onChange,
  onFocus,
  placeholder,
  validated,
  className,
  disabled,
  type = 'text',
  min,
  max,
}) => {
  const toLimit = (v: string) => {
    const minNum = Number.parseFloat(`${min}`)
    const maxNum = Number.parseFloat(`${max}`)
    if (!isNaN(minNum) && Number.parseFloat(v) < minNum) {
      onChange(`${min}`)
      return
    }
    if (!isNaN(maxNum) && Number.parseFloat(v) > maxNum)
      onChange(`${max}`)
  }

  return (
    <div className='relative'>
      <input
        tabIndex={0}
        // Do not set autoComplete for security - prevents browser from storing sensitive API keys
        className={`
          block h-8 w-full appearance-none rounded-lg border border-transparent bg-components-input-bg-normal px-3 text-sm
          text-components-input-text-filled caret-primary-600 outline-none
          placeholder:text-sm placeholder:text-text-tertiary
          hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active
          focus:bg-components-input-bg-active focus:shadow-xs
          ${validated ? 'pr-[30px]' : ''}
          ${className || ''}
        `}
        placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={e => toLimit(e.target.value)}
        onFocus={onFocus}
        value={value}
        disabled={disabled}
        type={type}
        min={min}
        max={max}
      />
      {validated && (
        <div className='absolute right-2.5 top-2.5'>
          <CheckCircle className='h-4 w-4 text-[#039855]' />
        </div>
      )}
    </div>
  )
}

export default Input
