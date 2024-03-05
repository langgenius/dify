import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ModelProvider,
  TypeWithI18N,
} from '../declarations'
import { ConfigurateMethodEnum } from '../declarations'
import {
  DEFAULT_BACKGROUND_COLOR,
  MODEL_PROVIDER_QUOTA_GET_FREE,
  modelTypeFormat,
} from '../utils'
import {
  useAnthropicBuyQuota,
  useFreeQuota,
  useLanguage,
  useUpdateModelProviders,
} from '../hooks'
import ModelBadge from '../model-badge'
import ProviderIcon from '../provider-icon'
import s from './index.module.css'
import { Plus, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import { CoinsStacked01 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Button from '@/app/components/base/button'
import { IS_CE_EDITION } from '@/config'

type ProviderCardProps = {
  provider: ModelProvider
  onOpenModal: (configurateMethod: ConfigurateMethodEnum) => void
}

const TIP_MAP: { [k: string]: TypeWithI18N } = {
  minimax: {
    en_US: 'Earn 1 million tokens for free',
    zh_Hans: '免费获取 100 万个 token',
  },
  spark: {
    en_US: 'Earn 3 million tokens (v3.0) for free',
    zh_Hans: '免费获取 300 万个 token (v3.0)',
  },
  zhipuai: {
    en_US: 'Earn 10 million tokens for free',
    zh_Hans: '免费获取 1000 万个 token',
  },
}
const ProviderCard: FC<ProviderCardProps> = ({
  provider,
  onOpenModal,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const updateModelProviders = useUpdateModelProviders()
  const handlePay = useAnthropicBuyQuota()
  const handleFreeQuotaSuccess = () => {
    updateModelProviders()
  }
  const handleFreeQuota = useFreeQuota(handleFreeQuotaSuccess)
  const configurateMethods = provider.configurate_methods.filter(method => method !== ConfigurateMethodEnum.fetchFromRemote)
  const canGetFreeQuota = MODEL_PROVIDER_QUOTA_GET_FREE.includes(provider.provider) && !IS_CE_EDITION && provider.system_configuration.enabled

  return (
    <div
      className='group relative flex flex-col justify-between px-4 py-3 h-[148px] border-[0.5px] border-black/5 rounded-xl shadow-xs hover:shadow-lg'
      style={{ background: provider.background || DEFAULT_BACKGROUND_COLOR }}
    >
      <div>
        <div className='py-0.5'>
          <ProviderIcon provider={provider} />
        </div>
        {
          provider.description && (
            <div className='mt-1 leading-4 text-xs text-black/[48]'>{provider.description[language] || provider.description.en_US}</div>
          )
        }
      </div>
      <div>
        <div className={`flex flex-wrap group-hover:hidden gap-0.5 ${canGetFreeQuota && 'pb-[18px]'}`}>
          {
            provider.supported_model_types.map(modelType => (
              <ModelBadge key={modelType}>
                {modelTypeFormat(modelType)}
              </ModelBadge>
            ))
          }
          {
            canGetFreeQuota && (
              <div className='absolute left-0 right-0 bottom-0 flex items-center h-[26px] px-4 bg-white/50 rounded-b-xl'>
                📣&nbsp;
                <div
                  className={`${s.vender} text-xs font-medium text-transparent truncate`}
                  title={TIP_MAP[provider.provider][language]}
                >
                  {TIP_MAP[provider.provider][language]}
                </div>
              </div>
            )
          }
        </div>
        {
          canGetFreeQuota && (
            <div className='hidden group-hover:block'>
              <Button
                className='mb-1 w-full h-7 text-xs'
                type='primary'
                onClick={() => handleFreeQuota(provider.provider)}
              >
                {t('common.modelProvider.getFreeTokens')}
              </Button>
            </div>
          )
        }
        <div className={`hidden group-hover:grid grid-cols-${configurateMethods.length} gap-1`}>
          {
            configurateMethods.map((method) => {
              if (method === ConfigurateMethodEnum.predefinedModel) {
                return (
                  <Button
                    key={method}
                    className='h-7 bg-white text-xs text-gray-700'
                    onClick={() => onOpenModal(method)}
                  >
                    <Settings01 className='mr-[5px] w-3.5 h-3.5' />
                    {t('common.operation.setup')}
                  </Button>
                )
              }
              return (
                <Button
                  key={method}
                  className='px-0 h-7 bg-white text-xs text-gray-700'
                  onClick={() => onOpenModal(method)}
                >
                  <Plus className='mr-[5px] w-3.5 h-3.5' />
                  {t('common.modelProvider.addModel')}
                </Button>
              )
            })
          }
          {
            provider.provider === 'anthropic' && !IS_CE_EDITION && (
              <Button
                className='h-7 text-xs text-gray-700'
                onClick={handlePay}
              >
                <CoinsStacked01 className='mr-[5px] w-3.5 h-3.5' />
                {t('common.modelProvider.buyQuota')}
              </Button>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default ProviderCard
