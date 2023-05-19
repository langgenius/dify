import type { Provider, ProviderAzureToken } from '@/models/common'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import ProviderInput, { ProviderValidateTokenInput} from '../provider-input'
import { useState } from 'react'
import { ValidatedStatus } from '../provider-input/useValidateToken'

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
  const [token, setToken] = useState(provider.token as ProviderAzureToken || {})
  const handleFocus = () => {
    if (token === provider.token) {
      token.openai_api_key = ''
      setToken({...token})
      onTokenChange({...token})
    }
  }
  const handleChange = (type: keyof ProviderAzureToken, v: string) => {
    token[type] = v
    setToken({...token})
    onTokenChange({...token})
  }

  return (
    <div className='px-4 py-3'>
      <ProviderInput 
        className='mb-4'
        name={t('common.provider.azure.apiBase')}
        placeholder={t('common.provider.azure.apiBasePlaceholder')}
        value={token.openai_api_base}
        onChange={(v) => handleChange('openai_api_base', v)}
      />
      <ProviderValidateTokenInput 
        className='mb-4'
        name={t('common.provider.azure.apiKey')}
        placeholder={t('common.provider.azure.apiKeyPlaceholder')}
        value={token.openai_api_key}
        onChange={v => handleChange('openai_api_key', v)}
        onFocus={handleFocus}
        onValidatedStatus={onValidatedStatus}
        providerName={provider.provider_name}
      />
      <Link className="flex items-center text-xs cursor-pointer text-primary-600" href="https://platform.openai.com/account/api-keys" target={'_blank'}>
        {t('common.provider.azure.helpTip')}
        <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
      </Link>
    </div>
  )
}

export default AzureProvider
