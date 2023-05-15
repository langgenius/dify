import type { Provider } from '@/models/common'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProviderValidateTokenInput } from '../provider-input'
import Link from 'next/link'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { ValidatedStatus } from '../provider-input/useValidateToken'

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
  const handleFocus = () => {
    if (token === provider.token) {
      setToken('')
      onTokenChange('')
    }
  }
  const handleChange = (v: string) => {
    setToken(v)
    onTokenChange(v)
  }

  return (
    <div className='px-4 pt-3 pb-4'>
      <ProviderValidateTokenInput 
        value={token}
        name={t('common.provider.apiKey')}
        placeholder={t('common.provider.enterYourKey')}
        onChange={handleChange}
        onFocus={handleFocus}
        onValidatedStatus={onValidatedStatus}
        providerName={provider.provider_name}
      />
      <Link className="inline-flex items-center mt-3 text-xs font-normal cursor-pointer text-primary-600 w-fit" href="https://platform.openai.com/account/api-keys" target={'_blank'}>
        {t('appOverview.welcome.getKeyTip')}
        <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
      </Link>
    </div>
  )
}

export default OpenaiProvider