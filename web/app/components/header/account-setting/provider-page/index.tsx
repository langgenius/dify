import { useState } from 'react'
import useSWR from 'swr'
import { fetchProviders } from '@/service/common'
import ProviderItem from './provider-item'
import OpenaiHostedProvider from './openai-hosted-provider'
import type { ProviderHosted } from '@/models/common'
import { LockClosedIcon } from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { IS_CE_EDITION } from '@/config'

const providersMap: {[k: string]: any} = {
  'openai-custom': {
    icon: 'openai',
    name: 'OpenAI',
  },
  'azure_openai-custom': {
    icon: 'azure',
    name: 'Azure OpenAI Service',
  }
}

// const providersList = [
//   {
//     id: 'openai',
//     name: 'OpenAI',
//     providerKey: '1',
//     status: '',
//     child: <OpenaiProvider />
//   },
//   {
//     id: 'azure',
//     name: 'Azure OpenAI Service',
//     providerKey: '1',
//     status: 'error',
//     child: <AzureProvider />
//   },
//   {
//     id: 'anthropic',
//     name: 'Anthropic',
//     providerKey: '',
//     status: '',
//     child: <div>placeholder</div>
//   },
//   {
//     id: 'hugging-face',
//     name: 'Hugging Face Hub',
//     providerKey: '',
//     comingSoon: true,
//     status: '',
//     child: <div>placeholder</div>
//   }
// ]

const ProviderPage = () => {
  const { t } = useTranslation()
  const [activeProviderId, setActiveProviderId] = useState('')
  const { data, mutate } = useSWR({ url: '/workspaces/current/providers' }, fetchProviders)
  const providers = data?.filter(provider => providersMap[`${provider.provider_name}-${provider.provider_type}`])?.map(provider => {
    const providerKey = `${provider.provider_name}-${provider.provider_type}`
    return {
      provider,
      icon: providersMap[providerKey].icon,
      name: providersMap[providerKey].name,
    }
  })
  const providerHosted = data?.filter(provider => provider.provider_name === 'openai' && provider.provider_type === 'system')?.[0]

  return (
    <div className='pb-7'>
      {
        providerHosted && !IS_CE_EDITION && (
          <>
            <div>
              <OpenaiHostedProvider provider={providerHosted as ProviderHosted} />
            </div>
            <div className='my-5 w-full h-0 border-[0.5px] border-gray-100' />
          </>
        )
      }
      <div>
        {
          providers?.map(providerItem => (
            <ProviderItem
              key={`${providerItem.provider.provider_name}-${providerItem.provider.provider_type}`}
              icon={providerItem.icon}
              name={providerItem.name}
              provider={providerItem.provider}
              activeId={activeProviderId}
              onActive={aid => setActiveProviderId(aid)}
              onSave={() => mutate()}
            />
          ))
        }
      </div>
      <div className='absolute bottom-0 w-full h-[42px] flex items-center bg-white text-xs text-gray-500'>
        <LockClosedIcon className='w-3 h-3 mr-1' />
        {t('common.provider.encrypted.front')}
        <Link
          className='text-primary-600 mx-1'
          target={'_blank'}
          href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
        >
          PKCS1_OAEP
        </Link>
        {t('common.provider.encrypted.back')}
      </div>
    </div>
  )
}

export default ProviderPage
