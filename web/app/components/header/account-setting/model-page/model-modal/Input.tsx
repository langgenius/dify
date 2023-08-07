import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { Field, FormValue } from '../declarations'
import { useValidate } from '../../key-validator/hooks'
import {
  ValidatedErrorIcon,
  ValidatedErrorMessage,
  ValidatedSuccessIcon,
  ValidatingTip,
} from '../../key-validator/ValidateStatus'
import { ValidatedStatus } from '../../key-validator/declarations'
import I18n from '@/context/i18n'

const Input = () => {
  return (
    <input
      className={`
        block px-3 w-full h-9 bg-gray-100 text-sm rounded-lg border border-transparent
        appearance-none outline-none caret-primary-600
        hover:border-[rgba(0,0,0,0.08)] hover:bg-gray-50
        focus:bg-white focus:border-gray-300 focus:shadow-xs
        placeholder:text-sm placeholder:text-gray-400
      `}
      placeholder='aaa'
    />
  )
}

type InputWithStatusProps = {
  field: Field
  formValue: FormValue
  onChange: (v: FormValue) => void
}
const InputWithStatus: FC<InputWithStatusProps> = ({
  field,
  formValue,
  onChange,
}) => {
  const { locale } = useContext(I18n)
  const [validate, validating, validatedStatusState] = useValidate(formValue)
  const showValidatedIcon = validatedStatusState.status === ValidatedStatus.Error || validatedStatusState.status === ValidatedStatus.Exceed || validatedStatusState.status === ValidatedStatus.Success

  const getValidatedIcon = () => {
    if (validatedStatusState.status === ValidatedStatus.Error || validatedStatusState.status === ValidatedStatus.Exceed)
      return <ValidatedErrorIcon />

    if (validatedStatusState.status === ValidatedStatus.Success)
      return <ValidatedSuccessIcon />
  }
  const getValidatedTip = () => {
    if (validating)
      return <ValidatingTip />

    if (validatedStatusState.status === ValidatedStatus.Error)
      return <ValidatedErrorMessage errorMessage={validatedStatusState.message ?? ''} />
  }

  const handleChange = (v: string) => {
    onChange({ ...formValue, [field.key]: v })

    if (v) {
      if (field.validate)
        validate(field.validate)
    }
    else {
      validate({ before: () => false })
    }
  }

  return (
    <div className='relative'>
      <input
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
      />
      <div className='absolute top-2.5 right-2.5'>{getValidatedIcon()}</div>
      {getValidatedTip()}
    </div>
  )
}

export { Input, InputWithStatus }
