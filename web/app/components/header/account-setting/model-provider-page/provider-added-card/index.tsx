import type { FC } from 'react'
import { useState } from 'react'
import { useContext } from 'use-context-selector'
import type { ModelProvider } from '../declarations'
import { languageMaps } from '../utils'
import ModelBadge from '../model-badge'
import CredentialPanel from './credential-panel'
import QuotaPanel from './quota-panel'
import ModelList from './model-list'
import I18n from '@/context/i18n'

type ProviderAddedCardProps = {
  provider: ModelProvider
}
const ProviderAddedCard: FC<ProviderAddedCardProps> = ({
  provider,
}) => {
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className='rounded-xl border-[0.5px] border-black/5 shadow-xs'>
      <div className='flex pl-3 py-2 pr-2 rounded-t-xl'>
        <div className='grow px-1 pt-1 pb-0.5'>
          <div className='mb-2' style={{ background: provider.icon_large[language] }} />
          <div className='flex gap-0.5'>
            {
              provider.supported_models_types.map(modelType => (
                <ModelBadge
                  key={modelType}
                  text={modelType.toLocaleUpperCase()}
                />
              ))
            }
          </div>
        </div>
        <QuotaPanel />
        <CredentialPanel />
      </div>
      {
        collapsed && (
          <div
            className='pl-4 py-1.5 text-xs font-medium text-gray-500 leading-9 bg-white/30 cursor-pointer'
            onClick={() => setCollapsed(false)}
          >
            5 Models
          </div>
        )
      }
      {
        !collapsed && (
          <ModelList
            provider={provider}
            models={[]}
            onCollapse={() => setCollapsed(true)}
          />
        )
      }
    </div>
  )
}

export default ProviderAddedCard
