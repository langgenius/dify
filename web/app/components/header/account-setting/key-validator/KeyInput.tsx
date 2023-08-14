import type { ChangeEvent } from 'react'
import {
  ValidatedErrorIcon,
  ValidatedErrorMessage,
  ValidatedSuccessIcon,
  ValidatingTip,
} from './ValidateStatus'
import { ValidatedStatus } from './declarations'
import type { ValidatedStatusState } from './declarations'

type KeyInputProps = {
  value?: string
  name: string
  placeholder: string
  className?: string
  onChange: (v: string) => void
  onFocus?: () => void
  validating: boolean
  validatedStatusState: ValidatedStatusState
}

const KeyInput = ({
  value,
  name,
  placeholder,
  className,
  onChange,
  onFocus,
  validating,
  validatedStatusState,
}: KeyInputProps) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value
    onChange(inputValue)
  }

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

  return (
    <div className={className}>
      <div className="mb-2 text-[13px] font-medium text-gray-800">{name}</div>
      <div className='
        flex items-center px-3 bg-white rounded-lg
        shadow-xs
      '>
        <input
          className='
            w-full py-[9px] mr-2
            text-xs font-medium text-gray-700 leading-[18px]
            appearance-none outline-none bg-transparent
          '
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
          onFocus={onFocus}
        />
        {getValidatedIcon()}
      </div>
      {getValidatedTip()}
    </div>
  )
}

export default KeyInput
