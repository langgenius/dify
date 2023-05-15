import { ChangeEvent, useEffect } from 'react'
import Link from 'next/link'
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import useValidateToken, { ValidatedStatus } from './useValidateToken'

interface IProviderInputProps {
  value?: string
  name: string
  placeholder: string
  className?: string
  onChange: (v: string) => void
  onFocus?: () => void
}

const ProviderInput = ({
  value,
  name,
  placeholder,
  className,
  onChange,
  onFocus,
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
      </div>
    </div>
  )
}

type TproviderInputProps = IProviderInputProps 
  & { 
      onValidatedStatus?: (status?: ValidatedStatus) => void
      providerName: string
    }
export const ProviderValidateTokenInput = ({
  value,
  name,
  placeholder,
  className,
  onChange,
  onFocus,
  onValidatedStatus,
  providerName
}: TproviderInputProps) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const [ validating, validatedStatus, validate ] = useValidateToken(providerName)

  useEffect(() => {
    if (typeof onValidatedStatus === 'function') {
      onValidatedStatus(validatedStatus)
    }
  }, [validatedStatus])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value
    onChange(inputValue)

    validate(inputValue)
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
        {
          validatedStatus === ValidatedStatus.Error && <ExclamationCircleIcon className='w-4 h-4 text-[#D92D20]' />
        }
        {
          validatedStatus === ValidatedStatus.Success && <CheckCircleIcon className='w-4 h-4 text-[#039855]' />
        }
      </div>
      {
        validating && (
          <div className={`mt-2 text-primary-600 text-xs font-normal`}>
            {t('common.provider.validating')}
          </div>
        )
      }
      {
        validatedStatus === ValidatedStatus.Exceed && !validating && (
          <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
            {t('common.provider.apiKeyExceedBill')}&nbsp;
            <Link 
              className='underline'
              href="https://platform.openai.com/account/api-keys" 
              target={'_blank'}>
              {locale === 'en' ? 'this link' : '这篇文档'}
            </Link>
          </div>
        )
      }
      {
        validatedStatus === ValidatedStatus.Error && !validating && (
          <div className={`mt-2 text-[#D92D20] text-xs font-normal`}>
            {t('common.provider.invalidKey')}
          </div>
        )
      }
    </div>
  )
}

export default ProviderInput