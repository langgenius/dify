import { ChangeEvent } from 'react'
import { ReactElement } from 'react-markdown/lib/react-markdown'

interface IProviderInputProps {
  value?: string
  name: string
  placeholder: string
  className?: string
  onChange: (v: string) => void
  onFocus?: () => void
  validatedIcon?: ReactElement
  validatedTip?: ReactElement
}

const ProviderInput = ({
  value,
  name,
  placeholder,
  className,
  onChange,
  onFocus,
  validatedIcon,
  validatedTip
}: IProviderInputProps) => {

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value
    onChange(inputValue)
  }

  return (
    <div className={className}>
      <div className="mb-2 text-[13px] font-medium text-gray-800">{name}</div>
      <div className='
        flex items-center px-3 bg-white rounded-lg
        shadow-[0_1px_2px_rgba(16,24,40,0.05)]
      '>
        <input 
          className='
            w-full py-[9px]
            text-xs font-medium text-gray-700 leading-[18px]
            appearance-none outline-none bg-transparent 
          ' 
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
          onFocus={onFocus}
        />
        {validatedIcon}
      </div>
      {validatedTip}
    </div>
  )
}

export default ProviderInput