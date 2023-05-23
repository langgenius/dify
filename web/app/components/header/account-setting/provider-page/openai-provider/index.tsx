import type { Provider } from '@/models/common'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ProviderInput from '../provider-input'
import Link from 'next/link'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import useValidateToken, { ValidatedStatus } from '../provider-input/useValidateToken'
import { 
  ValidatedErrorIcon, 
  ValidatedSuccessIcon,
  ValidatingTip,
  ValidatedExceedOnOpenaiTip,
  ValidatedErrorOnOpenaiTip
} from '../provider-input/Validate'

interface IOpenaiProviderProps {
  provider: Provider
  onValidatedStatus: (status?: ValidatedStatus) => void
  onTokenChange: (token: string) => void
}

const OpenaiProvider = ({
  provider,
  onValidatedStatus,
  onTokenChange
}: IOpenaiProviderProps) => {
  const { t } = useTranslation()
  const [token, setToken] = useState(provider.token as string || '')
  const [ validating, validatedStatus, setValidatedStatus, validate ] = useValidateToken(provider.provider_name)
  const handleFocus = () => {
    if (token === provider.token) {
      setToken('')
      onTokenChange('')
      setValidatedStatus(undefined)
    }
  }
  const handleChange = (v: string) => {
    setToken(v)
    onTokenChange(v)
    validate(v, {
      beforeValidating: () => {
        if (!v) {
          setValidatedStatus(undefined)
          return false
        }
        return true
      }
    })
  }
  useEffect(() => {
    if (typeof onValidatedStatus === 'function') {
      onValidatedStatus(validatedStatus)
    }
  }, [validatedStatus])

  const getValidatedIcon = () => {
    if (validatedStatus === ValidatedStatus.Error || validatedStatus === ValidatedStatus.Exceed) {
      return <ValidatedErrorIcon />
    }
    if (validatedStatus === ValidatedStatus.Success) {
      return <ValidatedSuccessIcon />
    }
  }
  const getValidatedTip = () => {
    if (validating) {
      return <ValidatingTip />
    }
    if (validatedStatus === ValidatedStatus.Exceed) {
      return <ValidatedExceedOnOpenaiTip />
    }
    if (validatedStatus === ValidatedStatus.Error) {
      return <ValidatedErrorOnOpenaiTip />
    }
  }

  return (
    <div className='px-4 pt-3 pb-4'>
      <ProviderInput 
        value={token}
        name={t('common.provider.apiKey')}
        placeholder={t('common.provider.enterYourKey')}
        onChange={handleChange}
        onFocus={handleFocus}
        validatedIcon={getValidatedIcon()}
        validatedTip={getValidatedTip()}
      />
      <Link className="inline-flex items-center mt-3 text-xs font-normal cursor-pointer text-primary-600 w-fit" href="https://platform.openai.com/account/api-keys" target={'_blank'}>
        {t('appOverview.welcome.getKeyTip')}
        <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
      </Link>
    </div>
  )
}

export default OpenaiProvider