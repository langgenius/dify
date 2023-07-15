import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import ProviderInput from '../provider-input'
import type { ValidatedStatusState } from '../provider-input/useValidateToken'
import useValidateToken, { ValidatedStatus } from '../provider-input/useValidateToken'
import {
  ValidatedErrorIcon,
  ValidatedErrorOnOpenaiTip,
  ValidatedSuccessIcon,
  ValidatingTip,
} from '../provider-input/Validate'
import type { Provider, ProviderAnthropicToken } from '@/models/common'

type AnthropicProviderProps = {
  provider: Provider
  onValidatedStatus: (status?: ValidatedStatusState) => void
  onTokenChange: (token: ProviderAnthropicToken) => void
}

const AnthropicProvider = ({
  provider,
  onValidatedStatus,
  onTokenChange,
}: AnthropicProviderProps) => {
  const { t } = useTranslation()
  const [token, setToken] = useState<ProviderAnthropicToken>((provider.token as ProviderAnthropicToken) || { anthropic_api_key: '' })
  const [validating, validatedStatus, setValidatedStatus, validate] = useValidateToken(provider.provider_name)
  const handleFocus = () => {
    if (token.anthropic_api_key === (provider.token as ProviderAnthropicToken).anthropic_api_key) {
      setToken({ anthropic_api_key: '' })
      onTokenChange({ anthropic_api_key: '' })
      setValidatedStatus({})
    }
  }
  const handleChange = (v: string) => {
    const apiKey = { anthropic_api_key: v }
    setToken(apiKey)
    onTokenChange(apiKey)
    validate(apiKey, {
      beforeValidating: () => {
        if (!v) {
          setValidatedStatus({})
          return false
        }
        return true
      },
    })
  }
  useEffect(() => {
    if (typeof onValidatedStatus === 'function')
      onValidatedStatus(validatedStatus)
  }, [validatedStatus])

  const getValidatedIcon = () => {
    if (validatedStatus?.status === ValidatedStatus.Error || validatedStatus.status === ValidatedStatus.Exceed)
      return <ValidatedErrorIcon />

    if (validatedStatus.status === ValidatedStatus.Success)
      return <ValidatedSuccessIcon />
  }
  const getValidatedTip = () => {
    if (validating)
      return <ValidatingTip />

    if (validatedStatus?.status === ValidatedStatus.Error)
      return <ValidatedErrorOnOpenaiTip errorMessage={validatedStatus.message ?? ''} />
  }

  return (
    <div className='px-4 pt-3 pb-4'>
      <ProviderInput
        value={token.anthropic_api_key}
        name={t('common.provider.apiKey')}
        placeholder={t('common.provider.enterYourKey')}
        onChange={handleChange}
        onFocus={handleFocus}
        validatedIcon={getValidatedIcon()}
        validatedTip={getValidatedTip()}
      />
      <Link className="inline-flex items-center mt-3 text-xs font-normal cursor-pointer text-primary-600 w-fit" href="https://docs.anthropic.com/claude/reference/getting-started-with-the-api" target={'_blank'}>
        {t('common.provider.anthropic.keyFrom')}
        <ArrowTopRightOnSquareIcon className='w-3 h-3 ml-1 text-primary-600' aria-hidden="true" />
      </Link>
    </div>
  )
}

export default AnthropicProvider
