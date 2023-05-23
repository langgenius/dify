import type { Provider, ProviderAzureToken } from '@/models/common'
import { ProviderName } from '@/models/common'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { useState, useEffect } from 'react'
import ProviderInput from '../provider-input'
import useValidateToken, { ValidatedStatus } from '../provider-input/useValidateToken'
import { 
  ValidatedErrorIcon, 
  ValidatedSuccessIcon,
  ValidatingTip,
  ValidatedErrorOnAzureOpenaiTip
} from '../provider-input/Validate'

interface IAzureProviderProps {
  provider: Provider
  onValidatedStatus: (status?: ValidatedStatus) => void
  onTokenChange: (token: ProviderAzureToken) => void
}
const AzureProvider = ({
  provider, 
  onTokenChange,
  onValidatedStatus
}: IAzureProviderProps) => {
  const { t } = useTranslation()
  const [token, setToken] = useState<ProviderAzureToken>(provider.provider_name === ProviderName.AZURE_OPENAI ? {...provider.token}: {})
  const [ validating, validatedStatus, setValidatedStatus, validate ] = useValidateToken(provider.provider_name)
  const handleFocus = (type: keyof ProviderAzureToken) => {
    if (token[type] === (provider?.token as ProviderAzureToken)[type]) {
      token[type] = ''
      setToken({...token})
      onTokenChange({...token})
      setValidatedStatus(undefined)
    }
  }
  const handleChange = (type: keyof ProviderAzureToken, v: string, validate: any) => {
    token[type] = v
    setToken({...token})
    onTokenChange({...token})
    validate({...token}, {
      beforeValidating: () => {
        if (!token.openai_api_base || !token.openai_api_key) {
          setValidatedStatus(undefined)
          return false
        }
        return true
      }
    })
  }
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
    if (validatedStatus === ValidatedStatus.Error) {
      return <ValidatedErrorOnAzureOpenaiTip />
    }
  }
  useEffect(() => {
    if (typeof onValidatedStatus === 'function') {
      onValidatedStatus(validatedStatus)
    }
  }, [validatedStatus])

  return (
    <div className='px-4 py-3'>
      <ProviderInput 
        className='mb-4'
        name={t('common.provider.azure.apiBase')}
        placeholder={t('common.provider.azure.apiBasePlaceholder')}
        value={token.openai_api_base}
        onChange={(v) => handleChange('openai_api_base', v, validate)}
        onFocus={() => handleFocus('openai_api_base')}
        validatedIcon={getValidatedIcon()}
      />
      <ProviderInput 
        className='mb-4'
        name={t('common.provider.azure.apiKey')}
        placeholder={t('common.provider.azure.apiKeyPlaceholder')}
        value={token.openai_api_key}
        onChange={(v) => handleChange('openai_api_key', v, validate)}
        onFocus={() => handleFocus('openai_api_key')}
        validatedIcon={getValidatedIcon()}
        validatedTip={getValidatedTip()}
      />
      <Link className="flex items-center text-xs cursor-pointer text-primary-600" href="https://platform.openai.com/account/api-keys" target={'_blank'}>
        {t('common.provider.azure.helpTip')}
        <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
      </Link>
    </div>
  )
}

export default AzureProvider
