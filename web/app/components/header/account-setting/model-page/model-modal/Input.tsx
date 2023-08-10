import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { Field, FormValue } from '../declarations'
import { ValidatedSuccessIcon } from '../../key-validator/ValidateStatus'
import { ValidatedStatus } from '../../key-validator/declarations'
import type { ValidatedStatusState } from '../../key-validator/declarations'
import I18n from '@/context/i18n'

type InputProps = {
  field: Field
  value: FormValue
  onChange: (v: FormValue) => void
  onFocus: () => void
  validatedStatusState: ValidatedStatusState
}
const Input: FC<InputProps> = ({
  field,
  value,
  onChange,
  onFocus,
  validatedStatusState,
}) => {
  const { locale } = useContext(I18n)
  const showValidatedIcon = validatedStatusState.status === ValidatedStatus.Success && value[field.key]

  const getValidatedIcon = () => {
    if (showValidatedIcon)
      return <div className='absolute top-2.5 right-2.5'><ValidatedSuccessIcon /></div>
  }

  const handleChange = (v: string) => {
    const newFormValue = { ...value, [field.key]: v }
    onChange(newFormValue)
  }

  return (
    <div className='relative'>
      <input
        tabIndex={-1}
        className={`
          block px-3 w-full h-9 bg-gray-100 text-sm rounded-lg border border-transparent
          appearance-none outline-none caret-primary-600
          hover:border-[rgba(0,0,0,0.08)] hover:bg-gray-50
          focus:bg-white focus:border-gray-300 focus:shadow-xs
          placeholder:text-sm placeholder:text-gray-400
          ${showValidatedIcon && 'pr-[30px]'}
        `}
        placeholder={field?.placeholder?.[locale] || ''}
        onChange={e => handleChange(e.target.value)}
        onFocus={onFocus}
        value={value[field.key] || ''}
      />
      {getValidatedIcon()}
    </div>
  )
}

export default Input
