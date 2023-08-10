import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { Field, FormValue } from '../declarations'
import {
  ValidatedErrorIcon,
  ValidatedSuccessIcon,
} from '../../key-validator/ValidateStatus'
import { ValidatedStatus } from '../../key-validator/declarations'
import type { ValidatedStatusState } from '../../key-validator/declarations'
import I18n from '@/context/i18n'

type InputProps = {
  field: Field
  value: FormValue
  onChange: (v: FormValue) => void
  validatedStatusState: ValidatedStatusState
}
const Input: FC<InputProps> = ({
  field,
  value,
  onChange,
  validatedStatusState,
}) => {
  const { locale } = useContext(I18n)
  const showValidatedIcon = validatedStatusState.status === ValidatedStatus.Error || validatedStatusState.status === ValidatedStatus.Exceed || validatedStatusState.status === ValidatedStatus.Success

  const getValidatedIcon = () => {
    if (validatedStatusState.status === ValidatedStatus.Error || validatedStatusState.status === ValidatedStatus.Exceed)
      return <ValidatedErrorIcon />

    if (validatedStatusState.status === ValidatedStatus.Success)
      return <ValidatedSuccessIcon />
  }

  const handleChange = (v: string) => {
    const newFormValue = { ...value, [field.key]: v }
    onChange(newFormValue)
  }

  const handleFocus = () => {

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
        onFocus={handleFocus}
        value={value[field.key] as string}
      />
      <div className='absolute top-2.5 right-2.5'>{getValidatedIcon()}</div>
    </div>
  )
}

export default Input
