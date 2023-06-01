import { useState } from 'react'
import cn from 'classnames'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import Indicator from '../../../indicator'
import OpenaiProvider from '../openai-provider'
import AzureProvider from '../azure-provider'
import type { ValidatedStatusState } from '../provider-input/useValidateToken'
import { ValidatedStatus } from '../provider-input/useValidateToken'
import s from './index.module.css'
import type { Provider, ProviderAzureToken } from '@/models/common'
import { ProviderName } from '@/models/common'
import { updateProviderAIKey } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'

type IProviderItemProps = {
  icon: string
  name: string
  provider: Provider
  activeId: string
  onActive: (v: string) => void
  onSave: () => void
}
const ProviderItem = ({
  activeId,
  icon,
  name,
  provider,
  onActive,
  onSave,
}: IProviderItemProps) => {
  const { t } = useTranslation()
  const [validatedStatus, setValidatedStatus] = useState<ValidatedStatusState>()
  const [loading, setLoading] = useState(false)
  const { notify } = useContext(ToastContext)
  const [token, setToken] = useState<ProviderAzureToken | string>(
    provider.provider_name === 'azure_openai'
      ? { openai_api_base: '', openai_api_key: '' }
      : '',
  )
  const id = `${provider.provider_name}-${provider.provider_type}`
  const isOpen = id === activeId
  const comingSoon = false
  const isValid = provider.is_valid

  const providerTokenHasSetted = () => {
    if (provider.provider_name === ProviderName.AZURE_OPENAI) {
      return (provider.token && provider.token.openai_api_base && provider.token.openai_api_key)
        ? {
          openai_api_base: provider.token.openai_api_base,
          openai_api_key: provider.token.openai_api_key,
        }
        : undefined
    }
    if (provider.provider_name === ProviderName.OPENAI)
      return provider.token
  }
  const handleUpdateToken = async () => {
    if (loading)
      return
    if (validatedStatus?.status === ValidatedStatus.Success) {
      try {
        setLoading(true)
        await updateProviderAIKey({ url: `/workspaces/current/providers/${provider.provider_name}/token`, body: { token } })
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onActive('')
      }
      catch (e) {
        notify({ type: 'error', message: t('common.provider.saveFailed') })
      }
      finally {
        setLoading(false)
        onSave()
      }
    }
  }

  return (
    <div className='mb-2 border-[0.5px] border-gray-200 bg-gray-50 rounded-md'>
      <div className='flex items-center px-4 h-[52px] cursor-pointer border-b-[0.5px] border-b-gray-200'>
        <div className={cn(s[`icon-${icon}`], 'mr-3 w-6 h-6 rounded-md')} />
        <div className='grow text-sm font-medium text-gray-800'>{name}</div>
        {
          providerTokenHasSetted() && !comingSoon && !isOpen && (
            <div className='flex items-center mr-4'>
              {!isValid && <div className='text-xs text-[#D92D20]'>{t('common.provider.invalidApiKey')}</div>}
              <Indicator color={!isValid ? 'red' : 'green'} className='ml-2' />
            </div>
          )
        }
        {
          !comingSoon && !isOpen && (
            <div className='
              px-3 h-[28px] bg-white border border-gray-200 rounded-md cursor-pointer
              text-xs font-medium text-gray-700 flex items-center
            ' onClick={() => onActive(id)}>
              {providerTokenHasSetted() ? t('common.provider.editKey') : t('common.provider.addKey')}
            </div>
          )
        }
        {
          comingSoon && !isOpen && (
            <div className='
              flex items-center px-2 h-[22px] border border-[#444CE7] rounded-md
              text-xs font-medium text-[#444CE7]
            '>
              {t('common.provider.comingSoon')}
            </div>
          )
        }
        {
          isOpen && (
            <div className='flex items-center'>
              <div className='
                flex items-center
                mr-[5px] px-3 h-7 rounded-md cursor-pointer
                text-xs font-medium text-gray-700
              ' onClick={() => onActive('')} >
                {t('common.operation.cancel')}
              </div>
              <div className='
                flex items-center
                px-3 h-7 rounded-md cursor-pointer bg-primary-700
                text-xs font-medium text-white
              ' onClick={handleUpdateToken}>
                {t('common.operation.save')}
              </div>
            </div>
          )
        }
      </div>
      {
        provider.provider_name === ProviderName.OPENAI && isOpen && (
          <OpenaiProvider
            provider={provider}
            onValidatedStatus={v => setValidatedStatus(v)}
            onTokenChange={v => setToken(v)}
          />
        )
      }
      {
        provider.provider_name === ProviderName.AZURE_OPENAI && isOpen && (
          <AzureProvider
            provider={provider}
            onValidatedStatus={v => setValidatedStatus(v)}
            onTokenChange={v => setToken(v)}
          />
        )
      }
    </div>
  )
}

export default ProviderItem
